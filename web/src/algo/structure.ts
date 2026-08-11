/**
 * Structural decomposition of a PPI network.
 *
 * These are the classical answers to "what shape is this network": which proteins form
 * fully connected groups, which single proteins hold a module together, which single
 * interactions do, and which parts survive when weak evidence is removed. Each is
 * cheap to define and expensive to eyeball, which is exactly the case for computing
 * rather than drawing.
 *
 * Everything here is iterative. Depth-first recursion on a real network reaches depths
 * in the tens of thousands and overflows the stack — a failure that appears only on
 * real data.
 */

import type { PpiGraph } from './graph'

// --- connected components ---------------------------------------------------

/** Component index per node, plus the number of components. */
export interface Components {
  readonly componentOf: readonly number[]
  readonly count: number
  /** Node indices per component, largest first. */
  readonly members: readonly (readonly number[])[]
}

export function connectedComponents(graph: PpiGraph): Components {
  const componentOf = new Array<number>(graph.order).fill(-1)
  const members: number[][] = []

  for (let start = 0; start < graph.order; start += 1) {
    if (componentOf[start] !== -1) continue
    const component = members.length
    const group: number[] = []
    const stack = [start]
    componentOf[start] = component

    while (stack.length > 0) {
      const node = stack.pop()!
      group.push(node)
      for (const neighbour of graph.adjacency[node]!) {
        if (componentOf[neighbour] === -1) {
          componentOf[neighbour] = component
          stack.push(neighbour)
        }
      }
    }
    members.push(group.sort((a, b) => a - b))
  }

  const order = members
    .map((group, index) => ({ group, index }))
    .sort((a, b) => b.group.length - a.group.length || a.index - b.index)

  // Renumber so component 0 is the largest, which is what every caller wants first.
  const remap = new Array<number>(members.length)
  order.forEach((entry, rank) => {
    remap[entry.index] = rank
  })

  return {
    componentOf: componentOf.map((c) => (c === -1 ? -1 : remap[c]!)),
    count: members.length,
    members: order.map((entry) => entry.group),
  }
}

// --- biconnected components, articulation points, bridges -------------------

export interface BiconnectedResult {
  /** Edge indices grouped into biconnected components. */
  readonly components: readonly (readonly number[])[]
  /** Node indices whose removal disconnects the graph. */
  readonly articulationPoints: readonly number[]
  /** Edge indices whose removal disconnects the graph. */
  readonly bridges: readonly number[]
}

/**
 * Hopcroft–Tarjan, iteratively.
 *
 * Articulation points are the proteins a module hangs from, and bridges the single
 * interactions holding two modules together. Both are exactly the places where one
 * badly supported edge does the most damage — which is why this pairs so naturally
 * with the trust score.
 */
export function biconnectedComponents(graph: PpiGraph): BiconnectedResult {
  const n = graph.order
  const discovery = new Array<number>(n).fill(-1)
  const low = new Array<number>(n).fill(0)
  const parentEdge = new Array<number>(n).fill(-1)
  const isArticulation = new Array<boolean>(n).fill(false)

  // Edge index lookup, since adjacency stores neighbours rather than edges.
  const edgeIndex = new Map<string, number>()
  graph.edges.forEach((edge, index) => {
    edgeIndex.set(edgeKey(edge.source, edge.target), index)
  })
  const edgeBetween = (a: number, b: number): number =>
    edgeIndex.get(edgeKey(a, b)) ?? -1

  const components: number[][] = []
  const bridges: number[] = []
  const edgeStack: number[] = []
  let timer = 0

  for (let root = 0; root < n; root += 1) {
    if (discovery[root] !== -1) continue

    let rootChildren = 0
    // Explicit stack of (node, index into its adjacency list).
    const stack: { node: number; cursor: number }[] = [{ node: root, cursor: 0 }]
    discovery[root] = low[root] = timer++

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const neighbours = graph.adjacency[frame.node]!

      if (frame.cursor < neighbours.length) {
        const neighbour = neighbours[frame.cursor]!
        frame.cursor += 1

        const edge = edgeBetween(frame.node, neighbour)
        if (edge === -1 || edge === parentEdge[frame.node]) continue

        if (discovery[neighbour] === -1) {
          edgeStack.push(edge)
          parentEdge[neighbour] = edge
          discovery[neighbour] = low[neighbour] = timer++
          if (frame.node === root) rootChildren += 1
          stack.push({ node: neighbour, cursor: 0 })
        } else if (discovery[neighbour]! < discovery[frame.node]!) {
          // Back edge.
          edgeStack.push(edge)
          low[frame.node] = Math.min(low[frame.node]!, discovery[neighbour]!)
        }
        continue
      }

      // Finished this node; fold its result into its parent.
      stack.pop()
      const parent = stack[stack.length - 1]
      if (!parent) break

      low[parent.node] = Math.min(low[parent.node]!, low[frame.node]!)

      if (low[frame.node]! >= discovery[parent.node]!) {
        // The parent separates this subtree from the rest.
        if (parent.node !== root) isArticulation[parent.node] = true

        const component: number[] = []
        const separator = parentEdge[frame.node]!
        for (;;) {
          const edge = edgeStack.pop()
          if (edge === undefined) break
          component.push(edge)
          if (edge === separator) break
        }
        if (component.length > 0) components.push(component)
        // A biconnected component of exactly one edge is a bridge.
        if (component.length === 1) bridges.push(component[0]!)
      }
    }

    // The root is an articulation point only if it has more than one DFS child.
    if (rootChildren > 1) isArticulation[root] = true
  }

  const articulationPoints: number[] = []
  for (let i = 0; i < n; i += 1) if (isArticulation[i]) articulationPoints.push(i)

  return {
    components: components.map((c) => c.sort((a, b) => a - b)),
    articulationPoints,
    bridges: bridges.sort((a, b) => a - b),
  }
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

// --- k-core -----------------------------------------------------------------

export interface CoreResult {
  /** Highest k for which each node is in the k-core. */
  readonly coreness: readonly number[]
  readonly maxCore: number
}

/**
 * k-core decomposition by repeated peeling.
 *
 * The k-core is the standard first cut at "the dense part": it survives noise far
 * better than a degree threshold, because removing a low-degree node can drop its
 * neighbours below the threshold too.
 */
export function kCores(graph: PpiGraph): CoreResult {
  const n = graph.order
  const degree = new Array<number>(n)
  for (let i = 0; i < n; i += 1) degree[i] = graph.degree(i)

  const coreness = new Array<number>(n).fill(0)
  const removed = new Array<boolean>(n).fill(false)
  // Bucket queue keyed by current degree: peeling in degree order is what makes this
  // linear rather than quadratic.
  const order = [...Array(n).keys()].sort((a, b) => degree[a]! - degree[b]!)

  let k = 0
  let processed = 0
  const queue = order.slice()

  while (processed < n) {
    // Find the next un-removed node of smallest degree.
    let chosen = -1
    let best = Infinity
    for (const node of queue) {
      if (removed[node]) continue
      if (degree[node]! < best) {
        best = degree[node]!
        chosen = node
        if (best === 0) break
      }
    }
    if (chosen === -1) break

    k = Math.max(k, degree[chosen]!)
    coreness[chosen] = k
    removed[chosen] = true
    processed += 1

    for (const neighbour of graph.adjacency[chosen]!) {
      if (!removed[neighbour]) degree[neighbour] = degree[neighbour]! - 1
    }
  }

  return { coreness, maxCore: k }
}

/** Node indices in the k-core, for a given k. */
export function coreSubgraph(cores: CoreResult, k: number): Set<number> {
  const keep = new Set<number>()
  cores.coreness.forEach((c, index) => {
    if (c >= k) keep.add(index)
  })
  return keep
}

// --- maximal cliques --------------------------------------------------------

export interface CliqueOptions {
  /** Ignore cliques smaller than this. Below 3 the result is mostly edges. */
  readonly minSize?: number
  /** Stop after this many cliques. Enumeration is exponential in the worst case. */
  readonly maxCliques?: number
}

export interface CliqueResult {
  /** Node indices per clique, largest first. */
  readonly cliques: readonly (readonly number[])[]
  /** True when the search hit `maxCliques` and the list is incomplete. */
  readonly truncated: boolean
}

/**
 * Maximal cliques by Bron–Kerbosch with pivoting, over a degeneracy ordering.
 *
 * In a PPI network a maximal clique is a set of proteins every one of which is
 * reported to interact with every other — the graph-theoretic shadow of a protein
 * complex. Enumeration is worst-case exponential, so the caller can cap it; when the
 * cap bites we say so rather than presenting a partial list as complete.
 */
export function maximalCliques(
  graph: PpiGraph,
  options: CliqueOptions = {},
): CliqueResult {
  const minSize = options.minSize ?? 3
  const maxCliques = options.maxCliques ?? 100_000

  const n = graph.order
  const neighbours: Set<number>[] = graph.adjacency.map((list) => new Set(list))
  const cliques: number[][] = []
  let truncated = false

  // Degeneracy ordering bounds the outer loop's work by the graph's degeneracy, which
  // for biological networks is far below the maximum degree.
  const order = degeneracyOrder(graph)
  const position = new Array<number>(n)
  order.forEach((node, index) => {
    position[node] = index
  })

  for (const node of order) {
    if (truncated) break

    const later = new Set<number>()
    const earlier = new Set<number>()
    for (const neighbour of neighbours[node]!) {
      if (position[neighbour]! > position[node]!) later.add(neighbour)
      else earlier.add(neighbour)
    }

    bronKerbosch([node], later, earlier, (clique) => {
      if (clique.length >= minSize) {
        cliques.push([...clique].sort((a, b) => a - b))
        if (cliques.length >= maxCliques) truncated = true
      }
      return !truncated
    })
  }

  function bronKerbosch(
    current: number[],
    candidates: Set<number>,
    excluded: Set<number>,
    emit: (clique: number[]) => boolean,
  ): boolean {
    if (candidates.size === 0 && excluded.size === 0) return emit(current)

    // Pivot on the vertex with the most candidate neighbours: every candidate adjacent
    // to it can be skipped, which is what makes the algorithm tractable.
    let pivot = -1
    let bestCount = -1
    for (const vertex of [...candidates, ...excluded]) {
      let count = 0
      for (const candidate of candidates) {
        if (neighbours[vertex]!.has(candidate)) count += 1
      }
      if (count > bestCount) {
        bestCount = count
        pivot = vertex
      }
    }

    const toVisit =
      pivot === -1
        ? [...candidates]
        : [...candidates].filter((v) => !neighbours[pivot]!.has(v))

    for (const vertex of toVisit) {
      const nextCandidates = new Set<number>()
      const nextExcluded = new Set<number>()
      for (const candidate of candidates) {
        if (neighbours[vertex]!.has(candidate)) nextCandidates.add(candidate)
      }
      for (const other of excluded) {
        if (neighbours[vertex]!.has(other)) nextExcluded.add(other)
      }

      current.push(vertex)
      const keepGoing = bronKerbosch(current, nextCandidates, nextExcluded, emit)
      current.pop()
      if (!keepGoing) return false

      candidates.delete(vertex)
      excluded.add(vertex)
    }
    return true
  }

  cliques.sort((a, b) => b.length - a.length || a[0]! - b[0]!)
  return { cliques, truncated }
}

/** Vertices ordered so each has as few later neighbours as possible. */
export function degeneracyOrder(graph: PpiGraph): number[] {
  const n = graph.order
  const degree = new Array<number>(n)
  for (let i = 0; i < n; i += 1) degree[i] = graph.degree(i)

  const removed = new Array<boolean>(n).fill(false)
  const order: number[] = []

  for (let step = 0; step < n; step += 1) {
    let chosen = -1
    let best = Infinity
    for (let i = 0; i < n; i += 1) {
      if (removed[i]) continue
      if (degree[i]! < best) {
        best = degree[i]!
        chosen = i
      }
    }
    if (chosen === -1) break
    removed[chosen] = true
    order.push(chosen)
    for (const neighbour of graph.adjacency[chosen]!) {
      if (!removed[neighbour]) degree[neighbour] = degree[neighbour]! - 1
    }
  }
  return order
}
