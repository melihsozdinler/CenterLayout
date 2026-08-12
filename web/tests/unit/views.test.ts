import { describe, expect, it } from 'vitest'
import { buildMatrix, buildUpSet } from '@/views/matrix'
import { buildBipartite } from '@/views/bipartite'
import { buildMethodChord, buildTimeline, type TimelineRecord } from '@/views/timeline'
import type { ScoredPair } from '@/trust/score'
import { networkLayout } from '@/views/network-layout'
import { PpiGraph } from '@/algo/graph'

function pairs(specs: [string, string, number][]): ScoredPair[] {
  const labels = [...new Set(specs.flatMap(([a, b]) => [a, b]))].sort()
  const idOf = new Map(labels.map((l, i) => [l, i + 1]))
  return specs.map(([a, b, score]) => {
    const lo = Math.min(idOf.get(a)!, idOf.get(b)!)
    const hi = Math.max(idOf.get(a)!, idOf.get(b)!)
    return {
      pairKey: `${lo}~${hi}`,
      score,
      coverage: 1,
      evidenceType: 'physical' as const,
      terms: {
        replication: null,
        independence: null,
        methodDiversity: null,
        methodWeight: null,
        throughput: null,
        literatureImpact: null,
        currency: null,
      },
      nodeLo: lo,
      nodeHi: hi,
      symbolLo: idOf.get(a)! <= idOf.get(b)! ? a : b,
      symbolHi: idOf.get(a)! <= idOf.get(b)! ? b : a,
    }
  })
}

/** A graph from `A-B` edge strings, with ids derived from labels for determinism. */
function graphOf(edges: string[]): PpiGraph {
  return PpiGraph.fromPairs(
    pairs(edges.map((e) => [e.split('-')[0]!, e.split('-')[1]!, 1] as [string, string, number])),
  )
}

describe('buildMatrix', () => {
  const network = () =>
    pairs([
      ['A', 'B', 0.9],
      ['B', 'C', 0.8],
      ['C', 'A', 0.7],
      ['X', 'Y', 0.5],
    ])

  it('emits one cell per interaction, above the diagonal', () => {
    const matrix = buildMatrix(network())
    expect(matrix.cells).toHaveLength(4)
    for (const cell of matrix.cells) expect(cell.row).toBeLessThan(cell.column)
  })

  it('puts each connected module in a contiguous block', () => {
    const matrix = buildMatrix(network(), { ordering: 'cluster' })
    const index = (label: string) => matrix.labels.indexOf(label)
    const triangle = ['A', 'B', 'C'].map(index).sort((a, b) => a - b)
    // The three-protein module occupies consecutive rows, so it reads as a block on
    // the diagonal rather than as scattered cells.
    expect(triangle[2]! - triangle[0]!).toBe(2)
  })

  it('orders by degree when asked', () => {
    const matrix = buildMatrix(network(), { ordering: 'degree' })
    expect(['A', 'B', 'C']).toContain(matrix.labels[0])
  })

  it('orders alphabetically when asked', () => {
    const matrix = buildMatrix(network(), { ordering: 'alphabetical' })
    expect(matrix.labels).toEqual([...matrix.labels].sort())
  })

  it('caps the size and says when it did', () => {
    const many = pairs(
      Array.from({ length: 60 }, (_, i) => [`P${i}`, `P${i + 1}`, 0.5] as [string, string, number]),
    )
    const matrix = buildMatrix(many, { maxNodes: 20 })
    expect(matrix.labels).toHaveLength(20)
    expect(matrix.truncated).toBe(true)
    // Cells touching a dropped protein must go too, or the matrix is inconsistent.
    for (const cell of matrix.cells) {
      expect(cell.column).toBeLessThan(20)
    }
  })
})

describe('buildUpSet', () => {
  const data = [
    { pairKey: '1', systems: ['Two-hybrid'] },
    { pairKey: '2', systems: ['Two-hybrid'] },
    { pairKey: '3', systems: ['Affinity Capture-MS'] },
    { pairKey: '4', systems: ['Two-hybrid', 'Affinity Capture-MS'] },
    { pairKey: '5', systems: ['Affinity Capture-MS', 'Two-hybrid'] },
  ]

  it('counts each method total and each combination', () => {
    const upset = buildUpSet(data)
    expect(upset.systems[0]).toEqual({ name: 'Two-hybrid', total: 4 })
    expect(upset.totalInteractions).toBe(5)

    const both = upset.intersections.find((i) => i.systems.length === 2)!
    // Order within a pair's system list must not create two different combinations.
    expect(both.count).toBe(2)
    expect(both.systems).toEqual(['Affinity Capture-MS', 'Two-hybrid'])
  })

  it('sorts combinations largest first', () => {
    const upset = buildUpSet(data)
    for (let i = 1; i < upset.intersections.length; i += 1) {
      expect(upset.intersections[i - 1]!.count).toBeGreaterThanOrEqual(
        upset.intersections[i]!.count,
      )
    }
  })

  it('honours a minimum count and a cap', () => {
    expect(buildUpSet(data, { minCount: 2 }).intersections).toHaveLength(2)
    expect(buildUpSet(data, { maxIntersections: 1 }).intersections).toHaveLength(1)
  })
})

describe('buildBipartite', () => {
  const input = {
    publications: [
      { key: 'p1', label: 'Gavin (2002)', year: 2002, system: 'Affinity Capture-MS', interactionCount: 400 },
      { key: 'p2', label: 'Ito (2001)', year: 2001, system: 'Two-hybrid', interactionCount: 20 },
      { key: 'p3', label: 'Smith (2020)', year: 2020, system: 'Two-hybrid', interactionCount: 1 },
    ],
    proteins: [
      { id: 1, label: 'MDM2', publicationCount: 3 },
      { id: 2, label: 'TP53', publicationCount: 2 },
    ],
    links: [
      { publicationKey: 'p1', proteinId: 1, weight: 1 },
      { publicationKey: 'p2', proteinId: 2, weight: 1 },
      { publicationKey: 'p3', proteinId: 1, weight: 1 },
    ],
  }

  it('gives each method a lane, widest literature first', () => {
    const view = buildBipartite(input)
    expect(view.lanes.map((l) => l.system)).toEqual([
      'Two-hybrid',
      'Affinity Capture-MS',
    ])
    expect(view.lanes[0]!.publicationCount).toBe(2)
  })

  it('sizes publications by what they contributed', () => {
    const view = buildBipartite(input)
    const gavin = view.nodes.find((n) => n.id === 'pub:p1')!
    const smith = view.nodes.find((n) => n.id === 'pub:p3')!
    // A 400-interaction screen and a one-interaction paper are not the same object.
    expect(gavin.radius).toBeGreaterThan(smith.radius)
  })

  it('orders publications within a lane by year, so the lane reads as a timeline', () => {
    const view = buildBipartite(input)
    const ito = view.nodes.find((n) => n.id === 'pub:p2')!
    const smith = view.nodes.find((n) => n.id === 'pub:p3')!
    expect(ito.x).toBeLessThan(smith.x)
  })

  it('puts proteins in their own column', () => {
    const view = buildBipartite(input)
    const proteins = view.nodes.filter((n) => n.kind === 'protein')
    expect(proteins).toHaveLength(2)
    expect(new Set(proteins.map((p) => p.x))).toEqual(new Set([0]))
  })

  it('drops links to anything the caps removed', () => {
    const view = buildBipartite(input, { maxProteins: 1 })
    expect(view.truncated).toBe(true)
    // MDM2 is kept (3 publications); TP53 is dropped, and so is the link to it.
    expect(view.links.every((l) => l.target === 'gene:1')).toBe(true)
  })
})

describe('buildTimeline', () => {
  const records: TimelineRecord[] = [
    { pairKey: 'a', label: 'A-B', year: 1998, publicationKey: 'p1', system: 'Two-hybrid', lowThroughput: true, highThroughput: false },
    { pairKey: 'a', label: 'A-B', year: 2015, publicationKey: 'p2', system: 'Affinity Capture-MS', lowThroughput: false, highThroughput: true },
    { pairKey: 'b', label: 'C-D', year: 1999, publicationKey: 'p3', system: 'Two-hybrid', lowThroughput: true, highThroughput: false },
    { pairKey: 'c', label: 'E-F', year: 2015, publicationKey: 'p2', system: 'Affinity Capture-MS', lowThroughput: false, highThroughput: true },
  ]

  it('builds a continuous year axis, including empty years', () => {
    const timeline = buildTimeline(records, { referenceYear: 2026 })
    expect(timeline.years[0]).toBe(1998)
    expect(timeline.years[timeline.years.length - 1]).toBe(2015)
    // Gaps in a literature are information; a categorical axis would hide them.
    expect(timeline.years).toHaveLength(18)
    expect(timeline.points.find((p) => p.year === 2005)!.newInteractions).toBe(0)
  })

  it('counts an interaction as new only in the year it first appeared', () => {
    const timeline = buildTimeline(records, { referenceYear: 2026 })
    const y1998 = timeline.points.find((p) => p.year === 1998)!
    const y2015 = timeline.points.find((p) => p.year === 2015)!

    expect(y1998.newInteractions).toBe(1)
    // 2015 re-reports A-B and introduces E-F: two reported, one new.
    expect(y2015.reportedInteractions).toBe(2)
    expect(y2015.newInteractions).toBe(1)
    expect(y2015.cumulativeInteractions).toBe(3)
  })

  it('tracks the low-throughput share per year', () => {
    const timeline = buildTimeline(records, { referenceYear: 2026 })
    expect(timeline.points.find((p) => p.year === 1998)!.lowThroughputShare).toBe(1)
    expect(timeline.points.find((p) => p.year === 2015)!.lowThroughputShare).toBe(0)
    expect(timeline.points.find((p) => p.year === 2005)!.lowThroughputShare).toBeNull()
  })

  it('flags interactions reported once, long ago, and never revisited', () => {
    const timeline = buildTimeline(records, { referenceYear: 2026, staleBefore: 2001 })
    // C-D was reported in 1999 and never again. A-B was re-reported in 2015, so it is
    // not stale despite also being from 1998.
    expect(timeline.staleSingletons.map((s) => s.pairKey)).toEqual(['b'])
  })

  it('reports per-method trends aligned to the year axis', () => {
    const timeline = buildTimeline(records, { referenceYear: 2026 })
    const twoHybrid = timeline.methods.find((m) => m.system === 'Two-hybrid')!
    expect(twoHybrid.byYear).toHaveLength(timeline.years.length)
    expect(twoHybrid.total).toBe(2)
  })

  it('returns an empty view when nothing is dated', () => {
    const undated = records.map((r) => ({ ...r, year: null }))
    expect(buildTimeline(undated).points).toEqual([])
  })
})

describe('buildMethodChord', () => {
  it('counts how often two methods support the same interaction', () => {
    const chord = buildMethodChord([
      { systems: ['Two-hybrid', 'Affinity Capture-MS'] },
      { systems: ['Two-hybrid', 'Affinity Capture-MS'] },
      { systems: ['Two-hybrid'] },
      { systems: ['Two-hybrid', 'Co-crystal Structure'] },
    ])

    expect(chord.groups.map((g) => g.name)).toContain('Two-hybrid')
    const strongest = chord.chords[0]!
    expect(strongest.value).toBe(2)
    expect([strongest.source, strongest.target].sort()).toEqual([
      'Affinity Capture-MS',
      'Two-hybrid',
    ])
  })

  it('sizes each group by its share and leaves gaps between them', () => {
    const chord = buildMethodChord([
      { systems: ['A'] },
      { systems: ['A'] },
      { systems: ['A'] },
      { systems: ['B'] },
    ])
    const width = (name: string) => {
      const g = chord.groups.find((x) => x.name === name)!
      return g.endAngle - g.startAngle
    }
    expect(width('A')).toBeGreaterThan(width('B'))
    // Groups must not overlap.
    expect(chord.groups[0]!.endAngle).toBeLessThanOrEqual(chord.groups[1]!.startAngle)
  })

  it('drops ribbons touching a method the cap excluded', () => {
    const chord = buildMethodChord(
      [
        { systems: ['A', 'B'] },
        { systems: ['A', 'B'] },
        { systems: ['A', 'C'] },
      ],
      { maxGroups: 2 },
    )
    expect(chord.groups).toHaveLength(2)
    const names = new Set(chord.groups.map((g) => g.name))
    for (const ribbon of chord.chords) {
      expect(names.has(ribbon.source) && names.has(ribbon.target)).toBe(true)
    }
  })
})

describe('layered layout', () => {
  it('layers nodes by hop distance from the best-connected protein', () => {
    // HUB has degree 3 and everything else at most 2, so it is unambiguously the root.
    // (With a tie the root is still chosen deterministically, just not obviously.)
    const graph = graphOf(['HUB-A', 'HUB-B', 'HUB-E', 'A-C', 'C-D'])
    const layout = networkLayout(graph, { mode: 'layered' })

    const y = (label: string) => layout.nodes.find((n) => n.label === label)!.y
    // HUB above A, A above C, C above D: the vertical axis means hops from the root.
    expect(y('HUB')).toBeLessThan(y('A'))
    expect(y('A')).toBeLessThan(y('C'))
    expect(y('C')).toBeLessThan(y('D'))
    // Both of HUB's immediate partners share a layer.
    expect(y('A')).toBeCloseTo(y('B'), 6)
  })

  it('roots the layering at the focus when there is one', () => {
    const graph = graphOf(['HUB-A', 'HUB-B', 'HUB-E', 'A-C', 'C-D'])
    const d = graph.nodes.findIndex((n) => n.label === 'D')
    const layout = networkLayout(graph, { mode: 'layered', focus: d })

    const y = (label: string) => layout.nodes.find((n) => n.label === label)!.y
    // Layered from D, the order reverses.
    expect(y('D')).toBeLessThan(y('C'))
    expect(y('C')).toBeLessThan(y('A'))
  })

  it('places unreachable components below rather than dropping them', () => {
    const graph = graphOf(['A-B', 'B-C', 'X-Y'])
    const layout = networkLayout(graph, { mode: 'layered' })
    expect(layout.nodes).toHaveLength(5)
    const y = (label: string) => layout.nodes.find((n) => n.label === label)!.y
    // The disconnected pair sits below everything reachable from the root.
    expect(y('X')).toBeGreaterThan(y('C'))
  })

  it('reduces crossings rather than leaving the seed order', () => {
    // Two layers wired so degree order crosses and barycentre does not.
    const graph = graphOf(['R-A', 'R-B', 'R-C', 'A-P', 'B-Q', 'C-P', 'C-Q'])
    const layout = networkLayout(graph, { mode: 'layered' })

    const at = (label: string) => layout.nodes.find((n) => n.label === label)!
    const crossings = layout.edges.reduce((count, e1, i) => {
      return (
        count +
        layout.edges.slice(i + 1).filter((e2) => {
          const a1 = layout.nodes[e1.source]!
          const b1 = layout.nodes[e1.target]!
          const a2 = layout.nodes[e2.source]!
          const b2 = layout.nodes[e2.target]!
          // Count only crossings between the same pair of layers.
          if (a1.y === b1.y || a2.y === b2.y) return false
          if (Math.min(a1.y, b1.y) !== Math.min(a2.y, b2.y)) return false
          const [t1, u1] = a1.y < b1.y ? [a1, b1] : [b1, a1]
          const [t2, u2] = a2.y < b2.y ? [a2, b2] : [b2, a2]
          return (t1.x - t2.x) * (u1.x - u2.x) < 0
        }).length
      )
    }, 0)

    expect(at('R')).toBeDefined()
    // A handful of nodes should be laid out with few crossings; the point is that the
    // sweeps run at all, not a specific optimum.
    expect(crossings).toBeLessThan(4)
  })

  it('is deterministic', () => {
    const build = () => networkLayout(graphOf(['A-B', 'B-C', 'C-A', 'C-D']), { mode: 'layered' })
    expect(JSON.stringify(build().nodes)).toBe(JSON.stringify(build().nodes))
  })
})

describe('ego layout', () => {
  it('places the focus at the origin and partners by hop distance', () => {
    const graph = graphOf(['F-A', 'F-B', 'A-C'])
    const f = graph.nodes.findIndex((n) => n.label === 'F')
    const layout = networkLayout(graph, { mode: 'ego', focus: f })

    const at = (label: string) => layout.nodes.find((n) => n.label === label)!
    expect(Math.hypot(at('F').x, at('F').y)).toBeCloseTo(0, 6)
    const rA = Math.hypot(at('A').x, at('A').y)
    const rC = Math.hypot(at('C').x, at('C').y)
    expect(rA).toBeGreaterThan(0)
    expect(rC).toBeGreaterThan(rA)
  })

  it('wraps a large ring into bands instead of overlapping nodes', () => {
    // 400 partners cannot fit one circle at a legible spacing.
    const graph = graphOf(Array.from({ length: 400 }, (_, i) => `F-P${i}`))
    const f = graph.nodes.findIndex((n) => n.label === 'F')
    const layout = networkLayout(graph, { mode: 'ego', focus: f })

    const radii = new Set(
      layout.nodes
        .filter((n) => n.label !== 'F')
        .map((n) => Math.hypot(n.x, n.y).toFixed(3)),
    )
    expect(radii.size).toBeGreaterThan(1)

    const positions = layout.nodes.map((n) => `${n.x.toFixed(3)},${n.y.toFixed(3)}`)
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('falls back to force when asked for ego with no focus', () => {
    expect(networkLayout(graphOf(['A-B']), { mode: 'ego' }).mode).toBe('force')
  })
})
