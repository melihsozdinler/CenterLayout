import { describe, expect, it } from 'vitest'
import { PpiGraph } from '@/algo/graph'
import {
  biconnectedComponents,
  connectedComponents,
  coreSubgraph,
  degeneracyOrder,
  kCores,
  maximalCliques,
} from '@/algo/structure'
import { edgeBetweenness, modularity, removeEdges } from '@/algo/removal'
import { contract } from '@/algo/contract'
import type { ScoredPair } from '@/trust/score'

/**
 * Build a graph from `A-B` edge strings, with optional trust scores.
 *
 * Gene ids are derived from the label rather than from first-seen order, so the same
 * set of edges always describes the same data no matter what order it is listed in —
 * which is what makes the determinism test below meaningful.
 */
function graphOf(edges: string[], scores?: number[]): PpiGraph {
  const labels = [...new Set(edges.flatMap((e) => e.split('-')))].sort()
  const ids = new Map(labels.map((label, index) => [label, index + 1]))
  const idOf = (name: string) => ids.get(name)!

  const pairs: ScoredPair[] = edges.map((spec, index) => {
    const [a, b] = spec.split('-') as [string, string]
    const lo = Math.min(idOf(a), idOf(b))
    const hi = Math.max(idOf(a), idOf(b))
    const loName = idOf(a) <= idOf(b) ? a : b
    const hiName = idOf(a) <= idOf(b) ? b : a
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
      symbolLo: loName,
      symbolHi: hiName,
    }
  })
  return PpiGraph.fromPairs(pairs)
}

const labelsOf = (graph: PpiGraph, indices: readonly number[]) =>
  indices.map((i) => graph.label(i)).sort()

describe('PpiGraph', () => {
  it('deduplicates and builds symmetric adjacency', () => {
    const graph = graphOf(['A-B', 'B-C', 'A-B'])
    expect(graph.order).toBe(3)
    expect(graph.size).toBe(2)
    const b = graph.nodes.findIndex((n) => n.label === 'B')
    expect(graph.degree(b)).toBe(2)
  })

  it('drops self-interactions, which break every algorithm here', () => {
    const graph = graphOf(['A-A', 'A-B'])
    expect(graph.size).toBe(1)
  })

  it('filters by trust score', () => {
    const pairs = [
      { spec: 'A-B', score: 0.9 },
      { spec: 'B-C', score: 0.2 },
    ]
    const full = graphOf(
      pairs.map((p) => p.spec),
      pairs.map((p) => p.score),
    )
    expect(full.size).toBe(2)

    const strong = PpiGraph.fromPairs(
      full.edges.map((e) => ({
        pairKey: e.pairKey,
        score: e.weight,
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
        nodeLo: full.nodes[e.source]!.id,
        nodeHi: full.nodes[e.target]!.id,
        symbolLo: full.label(e.source),
        symbolHi: full.label(e.target),
      })),
      { minScore: 0.5 },
    )
    expect(strong.size).toBe(1)
  })

  it('indexes nodes deterministically regardless of input order', () => {
    const a = graphOf(['A-B', 'C-D', 'B-C'])
    const b = graphOf(['B-C', 'C-D', 'A-B'])
    expect(a.nodes.map((n) => n.label)).toEqual(b.nodes.map((n) => n.label))
  })
})

describe('connectedComponents', () => {
  it('finds disjoint pieces, largest first', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'X-Y'])
    const result = connectedComponents(graph)
    expect(result.count).toBe(2)
    expect(result.members[0]).toHaveLength(3)
    expect(labelsOf(graph, result.members[1]!)).toEqual(['X', 'Y'])
  })

  it('handles a single path', () => {
    expect(connectedComponents(graphOf(['A-B', 'B-C', 'C-D'])).count).toBe(1)
  })
})

describe('biconnectedComponents', () => {
  it('finds the articulation point joining two triangles', () => {
    // Two triangles sharing node C: C is the only articulation point.
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-C'])
    const result = biconnectedComponents(graph)

    expect(labelsOf(graph, result.articulationPoints)).toEqual(['C'])
    expect(result.components).toHaveLength(2)
    expect(result.bridges).toHaveLength(0)
  })

  it('finds the bridge joining two triangles', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'])
    const result = biconnectedComponents(graph)

    // C-D is the single interaction holding the two modules together.
    expect(result.bridges).toHaveLength(1)
    const bridge = graph.edges[result.bridges[0]!]!
    expect([graph.label(bridge.source), graph.label(bridge.target)].sort()).toEqual([
      'C',
      'D',
    ])
    expect(labelsOf(graph, result.articulationPoints)).toEqual(['C', 'D'])
  })

  it('reports no articulation points in a cycle', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-D', 'D-A'])
    const result = biconnectedComponents(graph)
    expect(result.articulationPoints).toEqual([])
    expect(result.bridges).toEqual([])
    expect(result.components).toHaveLength(1)
  })

  it('treats every edge of a path as a bridge', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-D'])
    expect(biconnectedComponents(graph).bridges).toHaveLength(3)
  })

  it('does not overflow the stack on a long path', () => {
    // Recursive Hopcroft-Tarjan dies here; real networks reach these depths.
    const edges = Array.from({ length: 20_000 }, (_, i) => `n${i}-n${i + 1}`)
    const graph = graphOf(edges)
    expect(() => biconnectedComponents(graph)).not.toThrow()
    expect(biconnectedComponents(graph).bridges).toHaveLength(20_000)
  })
})

describe('kCores', () => {
  it('assigns higher coreness to the dense part', () => {
    // A 4-clique with a pendant tail.
    const graph = graphOf(['A-B', 'A-C', 'A-D', 'B-C', 'B-D', 'C-D', 'D-E', 'E-F'])
    const cores = kCores(graph)
    expect(cores.maxCore).toBe(3)

    const coreOf = (label: string) =>
      cores.coreness[graph.nodes.findIndex((n) => n.label === label)]!
    expect(coreOf('A')).toBe(3)
    expect(coreOf('F')).toBeLessThan(coreOf('A'))
  })

  it('extracts the k-core as a node set', () => {
    const graph = graphOf(['A-B', 'A-C', 'A-D', 'B-C', 'B-D', 'C-D', 'D-E'])
    const keep = coreSubgraph(kCores(graph), 3)
    expect(labelsOf(graph, [...keep])).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('maximalCliques', () => {
  it('finds a triangle', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A'])
    const { cliques } = maximalCliques(graph, { minSize: 3 })
    expect(cliques).toHaveLength(1)
    expect(labelsOf(graph, cliques[0]!)).toEqual(['A', 'B', 'C'])
  })

  it('finds overlapping cliques and orders them largest first', () => {
    // 4-clique ABCD plus a triangle CDE.
    const graph = graphOf([
      'A-B', 'A-C', 'A-D', 'B-C', 'B-D', 'C-D', 'C-E', 'D-E',
    ])
    const { cliques } = maximalCliques(graph, { minSize: 3 })
    expect(cliques[0]).toHaveLength(4)
    expect(labelsOf(graph, cliques[0]!)).toEqual(['A', 'B', 'C', 'D'])
    expect(labelsOf(graph, cliques[1]!)).toEqual(['C', 'D', 'E'])
  })

  it('finds no cliques in a tree', () => {
    expect(maximalCliques(graphOf(['A-B', 'B-C', 'C-D']), { minSize: 3 }).cliques).toEqual(
      [],
    )
  })

  it('says so when the cap truncates the enumeration', () => {
    // A 12-clique has many maximal sub-structures once capped.
    const labels = 'ABCDEFGHIJKL'.split('')
    const edges: string[] = []
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        edges.push(`${labels[i]}-${labels[j]}`)
      }
    }
    const complete = maximalCliques(graphOf(edges), { minSize: 3 })
    expect(complete.cliques).toHaveLength(1)
    expect(complete.truncated).toBe(false)

    const capped = maximalCliques(graphOf(edges), { minSize: 3, maxCliques: 0 })
    expect(capped.truncated).toBe(true)
  })

  it('produces a degeneracy ordering covering every node', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'C-D'])
    expect(degeneracyOrder(graph).sort()).toEqual([0, 1, 2, 3])
  })
})

describe('edgeBetweenness', () => {
  it('scores the bridge highest', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'])
    const active = new Set(graph.edges.map((_, i) => i))
    const betweenness = edgeBetweenness(graph, active)

    const ranked = [...betweenness.entries()].sort((a, b) => b[1] - a[1])
    const top = graph.edges[ranked[0]![0]]!
    expect([graph.label(top.source), graph.label(top.target)].sort()).toEqual(['C', 'D'])
  })

  it('is symmetric across a symmetric graph', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-D', 'D-A'])
    const values = [...edgeBetweenness(graph, new Set([0, 1, 2, 3])).values()]
    expect(new Set(values.map((v) => v.toFixed(6))).size).toBe(1)
  })
})

describe('modularity', () => {
  it('is positive for a partition matching the real modules', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'D-E', 'E-F', 'F-D', 'C-D'])
    const active = new Set(graph.edges.map((_, i) => i))
    const good = graph.nodes.map((n) => (['A', 'B', 'C'].includes(n.label) ? 0 : 1))
    const allOne = graph.nodes.map(() => 0)

    expect(modularity(graph, good, active)).toBeGreaterThan(0)
    // A single group explains nothing, by definition.
    expect(modularity(graph, allOne, active)).toBeCloseTo(0, 9)
  })
})

describe('removeEdges', () => {
  const twoModules = () =>
    graphOf(
      ['A-B', 'B-C', 'C-A', 'D-E', 'E-F', 'F-D', 'C-D'],
      [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.1],
    )

  it('betweenness removal splits the network at the join first', () => {
    const graph = twoModules()
    const result = removeEdges(graph, 'betweenness', { maxRemovals: 1 })
    const removed = graph.edges[result.steps[0]!.edge]!
    expect([graph.label(removed.source), graph.label(removed.target)].sort()).toEqual([
      'C',
      'D',
    ])
    expect(result.steps[0]!.components).toBe(2)
  })

  it('trust-ascending removal takes the weakest evidence first', () => {
    const graph = twoModules()
    const result = removeEdges(graph, 'trust-ascending', { maxRemovals: 1 })
    // The join is also the worst-supported edge here, which is the interesting case:
    // the module boundary is exactly where the evidence is thinnest.
    expect(result.steps[0]!.weight).toBeCloseTo(0.1, 9)
    expect(result.steps[0]!.components).toBe(2)
  })

  it('trust-descending is the opposite order', () => {
    const graph = twoModules()
    const result = removeEdges(graph, 'trust-descending', { maxRemovals: 1 })
    expect(result.steps[0]!.weight).toBeCloseTo(0.9, 9)
  })

  it('records the curve and picks the best partition by modularity', () => {
    const graph = twoModules()
    const result = removeEdges(graph, 'betweenness')

    expect(result.steps).toHaveLength(graph.size)
    expect(result.steps[result.steps.length - 1]!.components).toBe(graph.order)
    expect(result.bestPartition.modularity).toBeGreaterThan(0)

    // The best partition should be the two triangles.
    const groups = new Set(result.bestPartition.componentOf)
    expect(groups.size).toBe(2)
  })

  it('honours the removal cap', () => {
    const result = removeEdges(twoModules(), 'trust-ascending', { maxRemovals: 3 })
    expect(result.steps).toHaveLength(3)
  })
})

describe('contract', () => {
  const network = () =>
    graphOf(
      ['A-B', 'B-C', 'C-A', 'D-E', 'E-F', 'F-D', 'C-D'],
      [0.9, 0.8, 0.85, 0.7, 0.75, 0.72, 0.2],
    )

  it('contracts connected components into one node each', () => {
    const graph = graphOf(['A-B', 'B-C', 'X-Y'])
    const high = contract(graph, { strategy: 'connected-components' })
    expect(high.nodes).toHaveLength(2)
    expect(high.nodes[0]!.size).toBe(3)
    expect(high.edges).toHaveLength(0)
  })

  it('contracts cliques and carries trust mass on the links between them', () => {
    const high = contract(network(), { strategy: 'cliques', minGroupSize: 3 })

    expect(high.nodes).toHaveLength(2)
    expect(high.edges).toHaveLength(1)
    // The single weak interaction joining the two complexes.
    expect(high.edges[0]!.edgeCount).toBe(1)
    expect(high.edges[0]!.trustMass).toBeCloseTo(0.2, 9)
  })

  it('reports the mean internal trust of each group', () => {
    const high = contract(network(), { strategy: 'cliques', minGroupSize: 3 })
    for (const node of high.nodes) {
      expect(node.internalEdges).toBe(3)
      expect(node.internalTrust).toBeGreaterThan(0.6)
      expect(node.internalTrust).toBeLessThan(1)
    }
  })

  it('labels groups by their most-connected members, not by index alone', () => {
    const high = contract(network(), { strategy: 'cliques', minGroupSize: 3 })
    expect(high.nodes[0]!.label).toMatch(/^Clique 1: /)
    expect(high.nodes[0]!.memberLabels.length).toBe(3)
  })

  it('lists nodes no group claimed', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'C-Z'])
    const high = contract(graph, { strategy: 'cliques', minGroupSize: 3 })
    // Z hangs off the triangle and belongs to no clique.
    expect(high.ungrouped).toHaveLength(1)
  })

  it('contracts biconnected components into modules', () => {
    const graph = graphOf(['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'])
    const high = contract(graph, { strategy: 'biconnected-components', minGroupSize: 3 })
    expect(high.nodes).toHaveLength(2)
    expect(high.nodes.every((n) => n.label.startsWith('Module'))).toBe(true)
  })

  it('contracts an externally supplied partition', () => {
    const graph = network()
    const partition = graph.nodes.map((n) =>
      ['A', 'B', 'C'].includes(n.label) ? 0 : 1,
    )
    const high = contract(graph, { strategy: 'partition', partition })
    expect(high.nodes).toHaveLength(2)
    expect(high.edges).toHaveLength(1)
  })

  it('rejects the partition strategy without a partition', () => {
    expect(() => contract(network(), { strategy: 'partition' })).toThrow(/partition/)
  })
})
