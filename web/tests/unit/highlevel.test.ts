import { describe, expect, it } from 'vitest'
import { PpiGraph } from '@/algo/graph'
import { louvain, modularity } from '@/algo/community'
import {
  autoContract,
  contract,
  foldSmallModules,
  DRAW_PROTEINS_BELOW,
} from '@/algo/contract'
import { highLevelLayout } from '@/views/highlevel-layout'
import { highLevelNodeAt, highLevelScene } from '@/views/render/network-scene'
import type { ScoredPair } from '@/trust/score'

/** Build a graph from `A-B` edge strings, with optional trust scores. */
function graphOf(edges: string[], scores?: number[]): PpiGraph {
  const labels = [...new Set(edges.flatMap((e) => e.split('-')))].sort()
  const ids = new Map(labels.map((label, index) => [label, index + 1]))
  const idOf = (name: string) => ids.get(name)!

  const pairs: ScoredPair[] = edges.map((spec, index) => {
    const [a, b] = spec.split('-') as [string, string]
    const lo = Math.min(idOf(a), idOf(b))
    const hi = Math.max(idOf(a), idOf(b))
    return {
      pairKey: `${lo}~${hi}`,
      score: scores?.[index] ?? 1,
      coverage: 1,
      evidenceType: 'physical',
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
      symbolLo: idOf(a) <= idOf(b) ? a : b,
      symbolHi: idOf(a) <= idOf(b) ? b : a,
    }
  })
  return PpiGraph.fromPairs(pairs)
}

/** Two cliques of `size`, joined by a single edge. */
function barbell(size: number, gap = 0): PpiGraph {
  const edges: string[] = []
  for (let group = 0; group < 2; group += 1) {
    for (let i = 0; i < size; i += 1) {
      for (let j = i + 1; j < size; j += 1) {
        edges.push(`${group}x${i}-${group}x${j}`)
      }
    }
  }
  edges.push(`0x0-1x${gap}`)
  return graphOf(edges)
}

describe('louvain', () => {
  it('finds the two halves of a barbell', () => {
    const graph = barbell(6)
    const result = louvain(graph)

    expect(result.count).toBe(2)
    expect(result.modularity).toBeGreaterThan(0.3)

    // Every protein of a clique lands in the same community.
    const communityOf = (label: string) =>
      result.communityOf[graph.nodes.findIndex((n) => n.label === label)!]
    for (let i = 1; i < 6; i += 1) {
      expect(communityOf(`0x${i}`)).toBe(communityOf('0x1'))
      expect(communityOf(`1x${i}`)).toBe(communityOf('1x1'))
    }
    expect(communityOf('0x1')).not.toBe(communityOf('1x1'))
  })

  it('is deterministic — the same graph always gives the same partition', () => {
    // The published algorithm visits nodes in random order and so gives a different
    // answer per run. A figure that cannot be regenerated is not evidence.
    const graph = barbell(7)
    const a = louvain(graph)
    const b = louvain(graph)
    expect(a.communityOf).toEqual(b.communityOf)
    expect(a.modularity).toBeCloseTo(b.modularity, 12)
  })

  it('numbers communities from largest to smallest', () => {
    const graph = graphOf([
      'A-B', 'B-C', 'C-A', 'A-C',
      'D-E', 'E-F', 'F-G', 'G-D', 'D-F', 'E-G',
      'C-D',
    ])
    const result = louvain(graph)
    const sizes = Array.from({ length: result.count }, (_, c) =>
      result.communityOf.filter((x) => x === c).length,
    )
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
  })

  it('follows the evidence, not the edge count', () => {
    // B is joined to A's group by three barely-supported interactions and to C's group
    // by two well-replicated ones. Counting edges puts B with A; weighting by trust —
    // which is what the score is for — puts it with C.
    const graph = graphOf(
      ['A1-A2', 'A1-A3', 'A2-A3', 'A1-B', 'A2-B', 'A3-B',
       'C1-C2', 'C1-C3', 'C2-C3', 'C1-B', 'C2-B'],
      [0.9, 0.9, 0.9, 0.02, 0.02, 0.02,
       0.9, 0.9, 0.9, 0.95, 0.95],
    )
    const result = louvain(graph)
    const at = (label: string) =>
      result.communityOf[graph.nodes.findIndex((n) => n.label === label)!]
    expect(at('B')).toBe(at('C1'))
    expect(at('B')).not.toBe(at('A1'))
  })

  it('puts disconnected pieces in separate communities', () => {
    const result = louvain(graphOf(['A-B', 'B-C', 'C-A', 'X-Y', 'Y-Z', 'Z-X']))
    expect(result.count).toBe(2)
  })

  it('splits a graph that biconnected components cannot', () => {
    // A barbell whose halves are joined by two edges is biconnected as a whole: the
    // structural decomposition returns one component, and a drill-down that relied on
    // it would descend forever into the same picture.
    const edges: string[] = []
    for (let group = 0; group < 2; group += 1) {
      for (let i = 0; i < 5; i += 1) {
        for (let j = i + 1; j < 5; j += 1) edges.push(`${group}x${i}-${group}x${j}`)
      }
    }
    edges.push('0x0-1x0', '0x1-1x1')
    const graph = graphOf(edges)

    const structural = contract(graph, {
      strategy: 'biconnected-components',
      minGroupSize: 2,
    })
    expect(structural.nodes).toHaveLength(1)
    expect(louvain(graph).count).toBe(2)
  })

  it('handles an empty graph', () => {
    const result = louvain(PpiGraph.fromPairs([]))
    expect(result).toMatchObject({ count: 0, modularity: 0 })
  })

  it('agrees with the modularity computed independently', () => {
    const graph = barbell(6)
    const result = louvain(graph)
    expect(result.modularity).toBeCloseTo(modularity(graph, result.communityOf), 12)
  })
})

describe('contract by community', () => {
  it('groups by modularity and carries the link between the groups', () => {
    const high = contract(barbell(5), { strategy: 'communities', minGroupSize: 2 })
    expect(high.nodes).toHaveLength(2)
    expect(high.nodes.every((n) => n.label.startsWith('Community'))).toBe(true)
    expect(high.edges).toHaveLength(1)
    expect(high.edges[0]!.edgeCount).toBe(1)
  })
})

describe('autoContract', () => {
  it('prefers biconnected components where they decompose the graph', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'])
    const high = autoContract(graph)
    expect(high.strategy).toBe('biconnected-components')
    expect(high.nodes.length).toBeGreaterThan(1)
  })

  it('falls back to communities when the graph is biconnected', () => {
    // Nothing to peel: the structural decomposition would return the whole graph, so a
    // drill-down using it would never get anywhere.
    const edges: string[] = []
    for (let group = 0; group < 2; group += 1) {
      for (let i = 0; i < 5; i += 1) {
        for (let j = i + 1; j < 5; j += 1) edges.push(`${group}x${i}-${group}x${j}`)
      }
    }
    edges.push('0x0-1x0', '0x1-1x1')

    const high = autoContract(graphOf(edges))
    expect(high.strategy).toBe('communities')
    expect(high.nodes).toHaveLength(2)
  })

  it('always makes progress, so drilling terminates', () => {
    // The property the recursion depends on: contracting a graph must produce more
    // than one module, or opening a module shows exactly what you just clicked.
    const cases = [
      barbell(4),
      barbell(8, 3),
      graphOf(['A-B', 'B-C', 'C-D', 'D-E', 'E-F']),
      graphOf(['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D']),
    ]
    for (const graph of cases) {
      const high = autoContract(graph)
      expect(high.nodes.length).toBeGreaterThan(1)
      expect(Math.max(...high.nodes.map((n) => n.size))).toBeLessThan(graph.order)
    }
  })

  it('assigns every protein to exactly one module', () => {
    // Both halves of the invariant the drill-down rests on. Double-counting would size
    // modules wrong and make a click ambiguous; dropping would shrink the network a
    // little at every level, silently.
    const graph = graphOf([
      'A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D', 'F-G', 'G-H', 'H-I', 'I-G',
    ])
    const high = autoContract(graph)

    const seen = new Map<number, number>()
    for (const node of high.nodes) {
      for (const member of node.members) seen.set(member, (seen.get(member) ?? 0) + 1)
    }
    expect(seen.size).toBe(graph.order)
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
    expect(high.ungrouped).toHaveLength(0)
  })

  it('folds the long tail so the high-level graph stays readable', () => {
    // Twenty triangles joined in a chain: without folding, twenty nodes.
    const edges: string[] = []
    for (let i = 0; i < 20; i += 1) {
      edges.push(`${i}a-${i}b`, `${i}b-${i}c`, `${i}c-${i}a`)
      if (i > 0) edges.push(`${i - 1}a-${i}a`)
    }
    const high = autoContract(graphOf(edges), { maxModules: 6 })

    expect(high.nodes).toHaveLength(6)
    const folded = high.nodes.find((n) => n.id === 'gsmall')!
    expect(folded.label).toMatch(/small modules$/)
    // Folded, not dropped: every protein is still somewhere.
    const total = high.nodes.reduce((sum, n) => sum + n.size, 0)
    expect(total).toBe(autoContract(graphOf(edges), { maxModules: 999 })
      .nodes.reduce((sum, n) => sum + n.size, 0))
  })
})

describe('foldSmallModules', () => {
  const wide = () => {
    const edges: string[] = []
    for (let i = 0; i < 10; i += 1) {
      edges.push(`${i}a-${i}b`, `${i}b-${i}c`, `${i}c-${i}a`)
      if (i > 0) edges.push(`${i - 1}a-${i}a`)
    }
    return contract(graphOf(edges), {
      strategy: 'biconnected-components',
      minGroupSize: 2,
    })
  }

  it('leaves a graph that is already small enough alone', () => {
    const high = wide()
    expect(foldSmallModules(high, 999)).toBe(high)
  })

  it('keeps the interactions between folded modules as internal evidence', () => {
    const high = wide()
    const folded = foldSmallModules(high, 4)
    const small = folded.nodes.find((n) => n.id === 'gsmall')!

    const beforeEdges =
      high.nodes.reduce((sum, n) => sum + n.internalEdges, 0) +
      high.edges.reduce((sum, e) => sum + e.edgeCount, 0)
    const afterEdges =
      folded.nodes.reduce((sum, n) => sum + n.internalEdges, 0) +
      folded.edges.reduce((sum, e) => sum + e.edgeCount, 0)
    // Nothing is invented and nothing is lost: an interaction between two folded
    // modules moves inside the folded node rather than disappearing.
    expect(afterEdges).toBe(beforeEdges)
    expect(small.internalEdges).toBeGreaterThan(0)
  })
})

describe('highLevelLayout', () => {
  const layoutOf = (graph: PpiGraph) => highLevelLayout(autoContract(graph))

  it('places every module and reports what it covers', () => {
    const layout = layoutOf(barbell(5))
    expect(layout.nodes).toHaveLength(2)
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]!.edgeCount).toBe(1)
    expect(layout.proteinCount).toBe(10)
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const graph = barbell(6)
    expect(layoutOf(graph)).toEqual(layoutOf(graph))
  })

  it('places modules that link to nothing rather than dropping them', () => {
    // Two separate triangles: no interaction spans them, so the force layout never
    // sees either. A module connected to nothing is a finding, not an error.
    const high = contract(graphOf(['A-B', 'B-C', 'C-A', 'X-Y', 'Y-Z', 'Z-X']), {
      strategy: 'connected-components',
    })
    const layout = highLevelLayout(high)
    expect(layout.nodes).toHaveLength(2)
    expect(layout.edges).toHaveLength(0)
    const [a, b] = layout.nodes as [(typeof layout.nodes)[0], (typeof layout.nodes)[0]]
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1)
  })

  it('reports mean trust on a module link', () => {
    const graph = graphOf(
      ['A-B', 'B-C', 'C-A', 'D-E', 'E-F', 'F-D', 'C-D', 'A-E'],
      [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.2, 0.4],
    )
    const layout = highLevelLayout(
      contract(graph, { strategy: 'communities', minGroupSize: 2 }),
    )
    const link = layout.edges[0]!
    expect(link.edgeCount).toBe(2)
    expect(link.trustMass).toBeCloseTo(0.6, 9)
    expect(link.trust).toBeCloseTo(0.3, 9)
  })

  it('draws and hit-tests the modules it placed', () => {
    const layout = layoutOf(barbell(5))
    const scene = highLevelScene(layout)
    expect(scene.items.length).toBeGreaterThan(layout.nodes.length)

    const node = layout.nodes[0]!
    expect(highLevelNodeAt(layout, node.x, node.y)?.id).toBe(node.id)
    expect(highLevelNodeAt(layout, node.x + 10_000, node.y)).toBeNull()
  })
})

describe('the threshold for drawing proteins', () => {
  it('is a size a node-link diagram can still say something at', () => {
    expect(DRAW_PROTEINS_BELOW).toBeGreaterThan(50)
    expect(DRAW_PROTEINS_BELOW).toBeLessThan(1200)
  })
})
