import { describe, expect, it } from 'vitest'
import {
  AGGREGATE_SYSTEM_ID,
  centerLayout,
  circularMean,
  ORGANISM_ID,
  type CenterLayoutInput,
  type LayoutSector,
  type PublicationInput,
  type SystemInput,
} from '@/views/center-layout'

const system = (
  name: string,
  publicationCount: number,
  interactionCount = publicationCount * 10,
  type: 'physical' | 'genetic' = 'physical',
): SystemInput => ({ name, publicationCount, interactionCount, type })

const publication = (
  key: string,
  systems: string[],
  interactionCount = 5,
  year: number | null = 2015,
  proteinCount = interactionCount + 1,
): PublicationInput => ({
  key,
  label: `${key} (${year ?? '?'})`,
  systems,
  interactionCount,
  proteinCount,
  year,
})

/** A small but representative literature: three methods, seven publications. */
function sample(): CenterLayoutInput {
  return {
    organismLabel: 'Saccharomyces cerevisiae',
    systems: [
      system('Affinity Capture-MS', 4, 400),
      system('Two-hybrid', 2, 60),
      system('Co-crystal Structure', 1, 3),
    ],
    publications: [
      publication('p1', ['Affinity Capture-MS'], 200),
      publication('p2', ['Affinity Capture-MS'], 100),
      publication('p3', ['Affinity Capture-MS'], 60),
      publication('p4', ['Affinity Capture-MS', 'Two-hybrid'], 40),
      publication('p5', ['Two-hybrid'], 20),
      publication('p6', ['Co-crystal Structure'], 3),
      publication('p7', ['Two-hybrid'], 1),
    ],
  }
}

const TWO_PI = Math.PI * 2

describe('centerLayout structure', () => {
  it('builds the three levels of the published design', () => {
    const result = centerLayout(sample())

    const organism = result.nodes.filter((n) => n.kind === 'organism')
    const systems = result.nodes.filter((n) => n.kind === 'system')
    const publications = result.nodes.filter((n) => n.kind === 'publication')

    expect(organism).toHaveLength(1)
    expect(systems).toHaveLength(3)
    expect(publications).toHaveLength(7)

    expect(organism[0]!.x).toBe(0)
    expect(organism[0]!.y).toBe(0)
    expect(organism[0]!.ring).toBe(0)
    expect(systems.every((n) => n.ring === 1)).toBe(true)
    expect(publications.every((n) => n.ring >= 2)).toBe(true)
  })

  it('connects the organism to every method and each method to its publications', () => {
    const result = centerLayout(sample())

    const toSystems = result.edges.filter((e) => e.kind === 'organism-system')
    expect(toSystems).toHaveLength(3)
    expect(toSystems.every((e) => e.source === ORGANISM_ID)).toBe(true)

    // p4 used two methods, so it gets two edges: 7 publications, 8 memberships.
    const toPublications = result.edges.filter((e) => e.kind === 'system-publication')
    expect(toPublications).toHaveLength(8)
  })

  it('places every node on its ring, at the stated distance from the centre', () => {
    const result = centerLayout(sample())
    for (const node of result.nodes) {
      expect(Math.hypot(node.x, node.y)).toBeCloseTo(node.distance, 9)
    }
  })
})

describe('multi-method publications', () => {
  it('places a publication once, between the methods it used', () => {
    const result = centerLayout(sample())
    const p4 = result.nodes.find((n) => n.id === 'pub:p4')!

    // One node, not one per method — this is what ProLiVis 1.0 got wrong by filing
    // each publication under a single arbitrary system.
    expect(result.nodes.filter((n) => n.label.startsWith('p4'))).toHaveLength(1)
    expect(p4.systems).toEqual(['Affinity Capture-MS', 'Two-hybrid'])

    const sectors = new Map(result.sectors.map((s) => [s.system, s]))
    const mid = (s: LayoutSector) => (s.startAngle + s.endAngle) / 2
    const a = mid(sectors.get('Affinity Capture-MS')!)
    const b = mid(sectors.get('Two-hybrid')!)

    // Its angle lies between its two methods' sectors.
    const expected = Math.atan2(
      (Math.sin(a) + Math.sin(b)) / 2,
      (Math.cos(a) + Math.cos(b)) / 2,
    )
    const difference = Math.abs(
      ((p4.angle - expected + Math.PI + TWO_PI) % TWO_PI) - Math.PI,
    )
    // Within one placement slot of the exact circular mean.
    expect(difference).toBeLessThan(0.15)
  })

  it('can instead duplicate a publication into each method sector', () => {
    const result = centerLayout(sample(), { multiMethod: 'duplicate' })
    const copies = result.nodes.filter((n) => n.id.startsWith('pub:p4@'))
    expect(copies).toHaveLength(2)
    expect(result.nodes.filter((n) => n.kind === 'publication')).toHaveLength(8)
  })
})

describe('circularMean', () => {
  const sectors = new Map<string, LayoutSector>([
    ['a', { system: 'a', startAngle: 0, endAngle: 0.2, publicationCount: 1 }],
    ['b', { system: 'b', startAngle: TWO_PI - 0.2, endAngle: TWO_PI, publicationCount: 1 }],
    ['wide', { system: 'wide', startAngle: 1, endAngle: 3, publicationCount: 5 }],
    ['opposite', { system: 'opposite', startAngle: 1 + Math.PI, endAngle: 3 + Math.PI, publicationCount: 5 }],
  ])

  it('averages across the wrap-around, where arithmetic means fail', () => {
    // Sectors at ~0.1 and ~2π-0.1: the mean is 0, not π.
    const mean = circularMean(['a', 'b'], sectors)
    const wrapped = Math.abs(((mean + Math.PI + TWO_PI) % TWO_PI) - Math.PI)
    expect(wrapped).toBeLessThan(0.05)
  })

  it('falls back to the widest sector when directions cancel exactly', () => {
    // Diametrically opposed methods have no meaningful mean; dropping the node at the
    // centre would put a publication on top of the organism.
    const mean = circularMean(['wide', 'opposite'], sectors)
    expect(mean).toBeCloseTo(2, 6)
  })

  it('returns a single sector its own midpoint', () => {
    expect(circularMean(['wide'], sectors)).toBeCloseTo(2, 9)
  })
})

describe('sector allocation', () => {
  it('sizes sectors by share of the literature', () => {
    const result = centerLayout(sample())
    const width = (name: string) => {
      const s = result.sectors.find((x) => x.system === name)!
      return s.endAngle - s.startAngle
    }
    // 4 publications versus 2 versus 1.
    expect(width('Affinity Capture-MS')).toBeGreaterThan(width('Two-hybrid'))
    expect(width('Two-hybrid')).toBeGreaterThan(width('Co-crystal Structure'))
  })

  it('gives a one-publication method a visible floor rather than a sliver', () => {
    const lopsided = centerLayout({
      organismLabel: 'x',
      systems: [system('dominant', 1000), system('rare', 1)],
      publications: [publication('p', ['rare'])],
    })
    const rare = lopsided.sectors.find((s) => s.system === 'rare')!
    // Without a floor this would be 2π/1001 ≈ 0.006 rad and effectively unclickable.
    expect(rare.endAngle - rare.startAngle).toBeGreaterThan(0.05)
  })

  it('fills the circle without overlapping sectors', () => {
    const result = centerLayout(sample())
    let previousEnd = -Infinity
    let covered = 0
    for (const sector of result.sectors) {
      expect(sector.startAngle).toBeGreaterThanOrEqual(previousEnd)
      expect(sector.endAngle).toBeGreaterThan(sector.startAngle)
      covered += sector.endAngle - sector.startAngle
      previousEnd = sector.endAngle
    }
    // Sectors plus the gaps between them account for the whole circle.
    expect(covered).toBeLessThanOrEqual(TWO_PI)
    expect(covered).toBeGreaterThan(TWO_PI * 0.9)
  })
})

describe('third-level aggregation', () => {
  const longTail: CenterLayoutInput = {
    organismLabel: 'x',
    systems: [
      system('Affinity Capture-MS', 50),
      system('Two-hybrid', 20),
      system('FRET', 1),
      system('Far Western', 1),
      system('Co-localization', 1),
      system('PCA', 1),
    ],
    publications: [
      publication('a', ['Affinity Capture-MS']),
      publication('b', ['FRET']),
      publication('c', ['Far Western']),
    ],
  }

  it('folds the tail of rare methods into one node', () => {
    const result = centerLayout(longTail, { aggregateBelow: 5 })
    const aggregate = result.nodes.find((n) => n.kind === 'aggregate')!

    expect(aggregate).toBeDefined()
    expect(aggregate.aggregated).toEqual([
      'Co-localization',
      'FRET',
      'Far Western',
      'PCA',
    ])
    expect(result.nodes.filter((n) => n.kind === 'system')).toHaveLength(2)
  })

  it('reattaches publications whose only method was folded away', () => {
    const result = centerLayout(longTail, { aggregateBelow: 5 })
    const fret = result.nodes.find((n) => n.id === 'pub:b')!
    const edges = result.edges.filter((e) => e.target === fret.id)
    // Its edge goes to the aggregate node; a dangling publication would be worse
    // than a slightly coarser label.
    expect(edges.map((e) => e.source)).toEqual([AGGREGATE_SYSTEM_ID])
  })

  it('does not aggregate a single system, which would only hide its name', () => {
    const result = centerLayout(
      {
        organismLabel: 'x',
        systems: [system('common', 50), system('rare', 1)],
        publications: [publication('a', ['common'])],
      },
      { aggregateBelow: 5 },
    )
    expect(result.nodes.some((n) => n.kind === 'aggregate')).toBe(false)
    expect(result.nodes.filter((n) => n.kind === 'system')).toHaveLength(2)
  })

  it('leaves everything alone when aggregation is off', () => {
    const result = centerLayout(longTail)
    expect(result.nodes.filter((n) => n.kind === 'system')).toHaveLength(6)
    expect(result.nodes.some((n) => n.kind === 'aggregate')).toBe(false)
  })
})

describe('node sizing', () => {
  it('scales node area, not radius, with contribution', () => {
    const result = centerLayout(sample())
    const ms = result.nodes.find((n) => n.label === 'Affinity Capture-MS')!
    const crystal = result.nodes.find((n) => n.label === 'Co-crystal Structure')!

    expect(ms.radius).toBeGreaterThan(crystal.radius)
    // 400 vs 3 interactions is a 133x ratio in area but only ~11x in radius, which is
    // why the radius must go as the square root — otherwise one method swallows the view.
    expect(ms.radius / crystal.radius).toBeLessThan(20)
  })

  it('keeps every node within the configured size band', () => {
    const result = centerLayout(sample(), {
      systemNodeRadius: [10, 20],
      publicationNodeRadius: [4, 8],
    })
    for (const node of result.nodes) {
      if (node.kind === 'system' || node.kind === 'aggregate') {
        expect(node.radius).toBeGreaterThanOrEqual(10)
        expect(node.radius).toBeLessThanOrEqual(20)
      }
      if (node.kind === 'publication') {
        expect(node.radius).toBeGreaterThanOrEqual(4)
        expect(node.radius).toBeLessThanOrEqual(8)
      }
    }
  })
})

describe('determinism', () => {
  it('produces identical coordinates for identical input', () => {
    // The property ProLiVis 1.0 lacked: its force-directed engine drew the same data
    // differently every run, so published figures could not be regenerated.
    const a = centerLayout(sample())
    const b = centerLayout(sample())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('is unaffected by the order of the input arrays', () => {
    const original = sample()
    const shuffled: CenterLayoutInput = {
      ...original,
      systems: [...original.systems].reverse(),
      publications: [...original.publications].reverse(),
    }
    expect(JSON.stringify(centerLayout(shuffled))).toBe(
      JSON.stringify(centerLayout(original)),
    )
  })
})

describe('crowding', () => {
  it('pushes crowded publications outward rather than sideways', () => {
    // 200 publications all using one method: angle must keep its meaning, so the
    // overflow has to go into extra rings.
    const crowded = centerLayout({
      organismLabel: 'x',
      systems: [system('Affinity Capture-MS', 200)],
      publications: Array.from({ length: 200 }, (_, i) =>
        publication(`p${String(i).padStart(3, '0')}`, ['Affinity Capture-MS']),
      ),
    })

    const publications = crowded.nodes.filter((n) => n.kind === 'publication')
    expect(publications).toHaveLength(200)
    expect(Math.max(...publications.map((n) => n.ring))).toBeGreaterThan(2)
  })

  it('never places two publications at the same point', () => {
    const crowded = centerLayout({
      organismLabel: 'x',
      systems: [system('m', 60)],
      publications: Array.from({ length: 60 }, (_, i) =>
        publication(`p${String(i).padStart(2, '0')}`, ['m']),
      ),
    })
    const positions = crowded.nodes
      .filter((n) => n.kind === 'publication')
      .map((n) => `${n.x.toFixed(6)},${n.y.toFixed(6)}`)
    expect(new Set(positions).size).toBe(positions.length)
  })
})

describe('degenerate inputs', () => {
  it('handles an organism with no literature at all', () => {
    const empty = centerLayout({ organismLabel: 'x', systems: [], publications: [] })
    expect(empty.nodes).toHaveLength(1)
    expect(empty.edges).toHaveLength(0)
    expect(empty.sectors).toHaveLength(0)
    expect(empty.extent).toBeGreaterThan(0)
  })

  it('handles a single method with a single publication', () => {
    const tiny = centerLayout({
      organismLabel: 'x',
      systems: [system('only', 1)],
      publications: [publication('p', ['only'])],
    })
    expect(tiny.nodes).toHaveLength(3)
    expect(tiny.edges).toHaveLength(2)
  })

  it('places a publication citing an unknown method rather than dropping it', () => {
    const result = centerLayout({
      organismLabel: 'x',
      systems: [system('known', 1)],
      publications: [publication('orphan', ['not-in-the-system-list'])],
    })
    const orphan = result.nodes.find((n) => n.id === 'pub:orphan')
    expect(orphan).toBeDefined()
  })
})

describe('a literature larger than the band', () => {
  /**
   * `count` publications spread over `methods` methods, in descending contribution.
   *
   * Several methods, because that is the real shape: each sector owns a slice of the
   * circle, and a narrow slice holds far fewer publications per row than the whole
   * circle would.
   */
  const crowd = (count: number, methods = 20): CenterLayoutInput => {
    const names = Array.from({ length: methods }, (_, i) => `Method ${i}`)
    return {
      organismLabel: 'Homo sapiens',
      systems: names.map((name) =>
        system(name, Math.round(count / methods), Math.round(count / methods) * 10),
      ),
      publications: Array.from({ length: count }, (_, i) =>
        publication(`p${String(i).padStart(5, '0')}`, [names[i % methods]!], count - i),
      ),
    }
  }

  it('keeps the biggest contributors and drops the rest', () => {
    // The band is bounded on purpose — 41,218 human publications do not fit legibly
    // under any spacing — so this documents what happens instead of pretending it
    // cannot. What is dropped must be the smallest contributors, not an arbitrary
    // slice, or the picture would misrepresent the field.
    const layout = centerLayout(crowd(40_000), {})
    const drawn = layout.nodes.filter((n) => n.kind === 'publication')

    expect(drawn.length).toBeLessThan(40_000)
    expect(drawn.length).toBeGreaterThan(100)

    const keys = new Set(drawn.map((n) => n.id.replace(/^pub:/, '')))
    // p00000 contributes the most, p39999 the least.
    expect(keys.has('p00000')).toBe(true)
    expect(keys.has('p39999')).toBe(false)
  })

  it('draws everything when the literature fits', () => {
    const layout = centerLayout(crowd(40), {})
    expect(layout.nodes.filter((n) => n.kind === 'publication')).toHaveLength(40)
  })
})
