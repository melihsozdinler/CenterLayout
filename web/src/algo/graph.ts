/**
 * A compact undirected graph over protein interactions.
 *
 * Nodes are re-indexed to a dense 0..n-1 range so adjacency can live in typed arrays:
 * a whole-organism network is hundreds of thousands of edges, and an object-per-node
 * representation spends more time in the garbage collector than in the algorithm.
 *
 * Every algorithm in this directory is iterative rather than recursive. Depth-first
 * search on a PPI network reaches recursion depths in the tens of thousands, which
 * overflows the JavaScript stack — a limit that shows up only on real data, never on
 * a test fixture.
 */

import type { ScoredPair } from '../trust/score'

export interface GraphNode {
  /** BioGRID gene identifier. */
  readonly id: number
  readonly label: string
}

export interface GraphEdge {
  readonly source: number
  readonly target: number
  /** Trust score in [0, 1], or 1 when the graph was built without scores. */
  readonly weight: number
  readonly pairKey: string
}

export class PpiGraph {
  /** Dense index to BioGRID id. */
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  /** Adjacency by dense index, each sorted ascending. */
  readonly adjacency: readonly (readonly number[])[]
  private readonly indexById: ReadonlyMap<number, number>

  private constructor(
    nodes: GraphNode[],
    edges: GraphEdge[],
    adjacency: number[][],
    indexById: Map<number, number>,
  ) {
    this.nodes = nodes
    this.edges = edges
    this.adjacency = adjacency
    this.indexById = indexById
  }

  get order(): number {
    return this.nodes.length
  }

  get size(): number {
    return this.edges.length
  }

  index(id: number): number | undefined {
    return this.indexById.get(id)
  }

  degree(index: number): number {
    return this.adjacency[index]?.length ?? 0
  }

  label(index: number): string {
    return this.nodes[index]?.label ?? String(this.nodes[index]?.id ?? index)
  }

  /**
   * Build from scored pairs.
   *
   * Self-interactions are dropped: they are real biology, but a self-loop breaks the
   * invariants every algorithm here relies on (a clique containing a self-loop, a
   * bridge to oneself), and they carry no information about network structure.
   */
  static fromPairs(
    pairs: readonly ScoredPair[],
    options: { minScore?: number } = {},
  ): PpiGraph {
    const minScore = options.minScore ?? 0

    const indexById = new Map<number, number>()
    const nodes: GraphNode[] = []
    const addNode = (id: number, label: string | null): number => {
      const existing = indexById.get(id)
      if (existing !== undefined) return existing
      const index = nodes.length
      indexById.set(id, index)
      nodes.push({ id, label: label ?? String(id) })
      return index
    }

    const edges: GraphEdge[] = []
    const seen = new Set<string>()

    // Sort first so the dense indexing — and therefore every algorithm's tie-breaking
    // — depends only on the data, never on query order.
    const ordered = [...pairs].sort((a, b) =>
      a.pairKey < b.pairKey ? -1 : a.pairKey > b.pairKey ? 1 : 0,
    )

    for (const pair of ordered) {
      if (pair.score < minScore) continue
      if (pair.nodeLo === pair.nodeHi) continue
      if (seen.has(pair.pairKey)) continue
      seen.add(pair.pairKey)

      const source = addNode(pair.nodeLo, pair.symbolLo)
      const target = addNode(pair.nodeHi, pair.symbolHi)
      edges.push({ source, target, weight: pair.score, pairKey: pair.pairKey })
    }

    const adjacency: number[][] = nodes.map(() => [])
    for (const edge of edges) {
      adjacency[edge.source]!.push(edge.target)
      adjacency[edge.target]!.push(edge.source)
    }
    for (const list of adjacency) list.sort((a, b) => a - b)

    return new PpiGraph(nodes, edges, adjacency, indexById)
  }

  /** A subgraph induced on a set of dense indices, re-indexed densely again. */
  induced(keep: ReadonlySet<number>): PpiGraph {
    const pairs: ScoredPair[] = []
    for (const edge of this.edges) {
      if (!keep.has(edge.source) || !keep.has(edge.target)) continue
      const a = this.nodes[edge.source]!
      const b = this.nodes[edge.target]!
      pairs.push({
        pairKey: edge.pairKey,
        score: edge.weight,
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
        nodeLo: Math.min(a.id, b.id),
        nodeHi: Math.max(a.id, b.id),
        symbolLo: a.id <= b.id ? a.label : b.label,
        symbolHi: a.id <= b.id ? b.label : a.label,
      })
    }
    return PpiGraph.fromPairs(pairs)
  }

  /**
   * Reduce the graph to what a view can usefully draw.
   *
   * Density is the thing that decides whether a network picture informs or just fills
   * the canvas, and the three knobs here fail in different ways, so they are separate
   * rather than one "detail" slider:
   *
   *   - `maxEdges` keeps the best-supported interactions. Honest about ranking, but it
   *     can leave a protein looking unconnected because its edges lost a global race.
   *   - `minDegree` drops the periphery. A PPI network is mostly degree-1 leaves, so
   *     this is usually the most effective single control.
   *   - `keep` restricts to an explicit set, which is how the ego view works.
   *
   * Isolated nodes are removed afterwards: a node with no remaining edges is noise in
   * a network view, however interesting it was before the filter.
   */
  reduce(options: {
    maxEdges?: number
    minDegree?: number
    keep?: ReadonlySet<number>
  }): PpiGraph {
    let edges = this.edges.filter(
      (e) =>
        options.keep === undefined ||
        (options.keep.has(e.source) && options.keep.has(e.target)),
    )

    if (options.maxEdges !== undefined && edges.length > options.maxEdges) {
      edges = [...edges]
        .sort((a, b) => b.weight - a.weight || (a.pairKey < b.pairKey ? -1 : 1))
        .slice(0, options.maxEdges)
    }

    if (options.minDegree !== undefined && options.minDegree > 1) {
      // Iterate: removing a leaf can drop its neighbour below the threshold too, and
      // a single pass would leave a fringe of newly-underconnected nodes behind.
      for (;;) {
        const degree = new Map<number, number>()
        for (const e of edges) {
          degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
          degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
        }
        const survivors = edges.filter(
          (e) =>
            (degree.get(e.source) ?? 0) >= options.minDegree! &&
            (degree.get(e.target) ?? 0) >= options.minDegree!,
        )
        if (survivors.length === edges.length) break
        edges = survivors
      }
    }

    const keptNodes = new Set<number>()
    for (const e of edges) {
      keptNodes.add(e.source)
      keptNodes.add(e.target)
    }
    return this.induced(keptNodes)
  }

  /** Dense indices within `depth` hops of a node, including the node itself. */
  neighbourhood(index: number, depth: number): Set<number> {
    const seen = new Set<number>([index])
    let frontier = [index]
    for (let step = 0; step < depth; step += 1) {
      const next: number[] = []
      for (const node of frontier) {
        for (const neighbour of this.adjacency[node] ?? []) {
          if (!seen.has(neighbour)) {
            seen.add(neighbour)
            next.push(neighbour)
          }
        }
      }
      frontier = next
      if (frontier.length === 0) break
    }
    return seen
  }

  /** Edges as BioGRID id pairs with their weights, for export. */
  toEdgeList(): { source: number; target: number; weight: number }[] {
    return this.edges.map((e) => ({
      source: this.nodes[e.source]!.id,
      target: this.nodes[e.target]!.id,
      weight: e.weight,
    }))
  }
}
