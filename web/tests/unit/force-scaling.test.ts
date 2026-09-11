import { describe, expect, it } from 'vitest'
import { PpiGraph } from '@/algo/graph'
import {
  barnesHutRepulsion,
  exactRepulsion,
  EXACT_REPULSION_BELOW,
  MAX_FORCE_NODES,
  networkLayout,
  packDiscs,
} from '@/views/network-layout'
import type { ScoredPair } from '@/trust/score'

/** Seeded, so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A network with real module structure: `groups` dense clusters joined sparsely, which
 * is what a PPI network looks like to a layout — and what makes grouped and force
 * produce different pictures when both work.
 */
function modular(nodes: number, groups: number, seed = 1): PpiGraph {
  const random = rng(seed)
  const pairs: ScoredPair[] = []
  const seen = new Set<string>()
  const add = (a: number, b: number) => {
    if (a === b) return
    const lo = Math.min(a, b) + 1
    const hi = Math.max(a, b) + 1
    const key = `${lo}~${hi}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({
      pairKey: key,
      score: 0.3 + 0.6 * random(),
      coverage: 1,
      evidenceType: 'physical',
      terms: {
        replication: null, independence: null, methodDiversity: null, methodWeight: null,
        throughput: null, literatureImpact: null, currency: null,
      },
      nodeLo: lo,
      nodeHi: hi,
      symbolLo: `P${lo}`,
      symbolHi: `P${hi}`,
    })
  }
  const groupOf = (i: number) => i % groups
  for (let i = 0; i < nodes; i += 1) {
    // Three links inside the group, and rarely one outside it.
    for (let e = 0; e < 3; e += 1) {
      const j = Math.floor(random() * (nodes / groups)) * groups + groupOf(i)
      if (j < nodes) add(i, j)
    }
    if (random() < 0.08) add(i, Math.floor(random() * nodes))
  }
  return PpiGraph.fromPairs(pairs)
}

describe('Barnes–Hut repulsion', () => {
  it('agrees with the exact computation', () => {
    // The approximation is only acceptable if the forces it produces are the forces
    // the exact computation would have produced, to within a few per cent.
    const n = 1500
    const random = rng(7)
    const x = Float64Array.from({ length: n }, () => (random() - 0.5) * 1000)
    const y = Float64Array.from({ length: n }, () => (random() - 0.5) * 1000)
    const k = 25

    const ex = new Float64Array(n)
    const ey = new Float64Array(n)
    exactRepulsion(x, y, ex, ey, n, k)
    const bx = new Float64Array(n)
    const by = new Float64Array(n)
    barnesHutRepulsion(x, y, bx, by, n, k)

    let errorSum = 0
    let magnitudeSum = 0
    for (let i = 0; i < n; i += 1) {
      errorSum += Math.hypot(bx[i]! - ex[i]!, by[i]! - ey[i]!)
      magnitudeSum += Math.hypot(ex[i]!, ey[i]!)
    }
    expect(errorSum / magnitudeSum).toBeLessThan(0.05)
  })

  it('survives coincident points', () => {
    // Nodes stacked on one spot — a seeded start or a collapsed cluster can produce
    // them — must not produce NaN or an unbounded subdivision.
    const n = 1200
    const x = new Float64Array(n).fill(3)
    const y = new Float64Array(n).fill(-4)
    for (let i = 0; i < 20; i += 1) x[i] = i * 10
    const dx = new Float64Array(n)
    const dy = new Float64Array(n)
    barnesHutRepulsion(x, y, dx, dy, n, 10)
    for (let i = 0; i < n; i += 1) {
      expect(Number.isFinite(dx[i]!)).toBe(true)
      expect(Number.isFinite(dy[i]!)).toBe(true)
    }
  })
})

describe('force and grouped are different arrangements', () => {
  it('draws force as force at sizes that used to fall back to grouped', () => {
    // 1,800 proteins is a coronavirus organism at default settings, and was above the
    // old cap: pressing Force drew Grouped.
    const graph = modular(1800, 12)
    expect(graph.order).toBeGreaterThan(EXACT_REPULSION_BELOW)
    expect(graph.order).toBeLessThan(MAX_FORCE_NODES)

    const layout = networkLayout(graph, { mode: 'force' })
    expect(layout.mode).toBe('force')
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
  })

  it('groups by community, so grouped is not one disc', () => {
    // A PPI network is one connected component. Grouping by component gave one group.
    const graph = modular(600, 8)
    const layout = networkLayout(graph, { mode: 'grouped' })
    expect(layout.groupCount).toBeGreaterThan(3)

    const sizes = new Map<number, number>()
    for (const node of layout.nodes) sizes.set(node.group, (sizes.get(node.group) ?? 0) + 1)
    expect(Math.max(...sizes.values())).toBeLessThan(graph.order * 0.6)
  })

  it('puts proteins in different places under the two arrangements', () => {
    const graph = modular(1500, 10)
    const force = networkLayout(graph, { mode: 'force' })
    const grouped = networkLayout(graph, { mode: 'grouped' })
    expect(force.mode).toBe('force')
    expect(grouped.mode).toBe('grouped')

    let moved = 0
    for (let i = 0; i < graph.order; i += 1) {
      const a = force.nodes[i]!
      const b = grouped.nodes[i]!
      if (Math.hypot(a.x - b.x, a.y - b.y) > 5) moved += 1
    }
    expect(moved / graph.order).toBeGreaterThan(0.9)
  })

  it('keeps communities together in the force layout too', () => {
    // A check that Barnes–Hut produces a *layout*, not merely finite numbers: members
    // of one community should sit closer to each other than to the rest.
    const graph = modular(1500, 6)
    const layout = networkLayout(graph, { mode: 'force' })
    const byGroup = new Map<number, { x: number; y: number }[]>()
    for (const node of layout.nodes) {
      const list = byGroup.get(node.group) ?? []
      list.push({ x: node.x, y: node.y })
      byGroup.set(node.group, list)
    }
    const centroid = (points: { x: number; y: number }[]) => ({
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    })
    const spread = (points: { x: number; y: number }[]) => {
      const c = centroid(points)
      return points.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y), 0) / points.length
    }
    const all = layout.nodes.map((n) => ({ x: n.x, y: n.y }))
    const within =
      [...byGroup.values()].filter((g) => g.length > 20).map(spread)
    const mean = within.reduce((s, v) => s + v, 0) / within.length
    expect(mean).toBeLessThan(spread(all) * 0.8)
  })

  it('is deterministic above the exact-repulsion threshold', () => {
    const graph = modular(1300, 9)
    const a = networkLayout(graph, { mode: 'force' })
    const b = networkLayout(graph, { mode: 'force' })
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual(b.nodes.map((n) => [n.x, n.y]))
  })

  it('lays out a few thousand proteins in interactive time', () => {
    const graph = modular(4000, 20)
    const started = performance.now()
    const layout = networkLayout(graph, { mode: 'force' })
    const seconds = (performance.now() - started) / 1000
    expect(layout.mode).toBe('force')
    // Measured, not guessed: the point of the change is that this is a click, not a wait.
    console.log(`  force layout, ${graph.order} proteins: ${seconds.toFixed(2)}s`)
    expect(seconds).toBeLessThan(8)
  })
})

describe('sparse networks', () => {
  /** A connected core, plus `islands` small components that touch nothing. */
  function coreAndIslands(core: number, islands: number): PpiGraph {
    const edges: [number, number][] = []
    for (let i = 1; i < core; i += 1) {
      edges.push([i, Math.floor(i / 2)])
      if (i > 3) edges.push([i, i - 3])
    }
    let next = core
    for (let c = 0; c < islands; c += 1) {
      const size = 2 + (c % 3)
      for (let j = 1; j < size; j += 1) edges.push([next, next + j])
      next += size
    }
    const pairs: ScoredPair[] = edges.map(([a, b]) => {
      const lo = Math.min(a, b) + 1
      const hi = Math.max(a, b) + 1
      return {
        pairKey: `${lo}~${hi}`,
        score: 0.6,
        coverage: 1,
        evidenceType: 'physical',
        terms: {
          replication: null, independence: null, methodDiversity: null, methodWeight: null,
          throughput: null, literatureImpact: null, currency: null,
        },
        nodeLo: lo,
        nodeHi: hi,
        symbolLo: `P${lo}`,
        symbolHi: `P${hi}`,
      }
    })
    return PpiGraph.fromPairs(pairs)
  }

  it('keeps small components near the core instead of flinging them off', () => {
    // A component with no edge to the rest feels only repulsion from it, and under one
    // embedding drifts out until the view has to zoom out to find it — shrinking the
    // part of the network anyone came to see.
    const graph = coreAndIslands(150, 40)
    const layout = networkLayout(graph, { mode: 'force' })

    const core = new Set(Array.from({ length: 150 }, (_, i) => i + 1))
    const reach = (ids: (n: (typeof layout.nodes)[number]) => boolean) =>
      Math.max(...layout.nodes.filter(ids).map((n) => Math.hypot(n.x, n.y)))
    const coreReach = reach((n) => core.has(n.id))
    const allReach = reach(() => true)

    // The islands ring the core; they do not set the scale.
    expect(allReach).toBeLessThan(coreReach * 2.5)
  })

  it('does not let packed components overlap', () => {
    const graph = coreAndIslands(80, 30)
    const layout = networkLayout(graph, { mode: 'force' })
    // Nodes of different components are never on top of one another.
    const componentOf = new Map<number, number>()
    // Recover components from the edges.
    const parent = new Map<number, number>()
    const find = (a: number): number => {
      while (parent.get(a) !== a) a = parent.get(a)!
      return a
    }
    for (const node of layout.nodes) parent.set(node.index, node.index)
    for (const edge of layout.edges) parent.set(find(edge.source), find(edge.target))
    for (const node of layout.nodes) componentOf.set(node.index, find(node.index))

    let closest = Infinity
    for (const a of layout.nodes) {
      for (const b of layout.nodes) {
        if (a.index >= b.index) continue
        if (componentOf.get(a.index) === componentOf.get(b.index)) continue
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y))
      }
    }
    expect(closest).toBeGreaterThan(5)
  })

  it('packs discs without overlap, largest first at the centre', () => {
    const random = rng(11)
    const radii = Array.from({ length: 60 }, () => 5 + random() * 40).sort((a, b) => b - a)
    const centres = packDiscs(radii)

    expect(centres[0]).toEqual({ x: 0, y: 0 })
    for (let i = 0; i < radii.length; i += 1) {
      for (let j = i + 1; j < radii.length; j += 1) {
        const d = Math.hypot(centres[i]!.x - centres[j]!.x, centres[i]!.y - centres[j]!.y)
        expect(d).toBeGreaterThanOrEqual(radii[i]! + radii[j]! - 1e-6)
      }
    }
    expect(packDiscs(radii)).toEqual(centres)
  })
})

describe('grouped', () => {
  it('never draws one community on top of another', () => {
    // Placed on a fixed ring, a large community's disc ran over its neighbours'.
    const graph = modular(900, 9)
    const layout = networkLayout(graph, { mode: 'grouped' })
    const byGroup = new Map<number, { x: number; y: number }[]>()
    for (const node of layout.nodes) {
      const list = byGroup.get(node.group) ?? []
      list.push({ x: node.x, y: node.y })
      byGroup.set(node.group, list)
    }
    const discs = [...byGroup.values()].map((points) => {
      const cx = points.reduce((s, p) => s + p.x, 0) / points.length
      const cy = points.reduce((s, p) => s + p.y, 0) / points.length
      const r = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.y - cy)))
      return { cx, cy, r }
    })
    for (let i = 0; i < discs.length; i += 1) {
      for (let j = i + 1; j < discs.length; j += 1) {
        const a = discs[i]!
        const b = discs[j]!
        expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(a.r + b.r)
      }
    }
  })
})
