/**
 * Edge-removal strategies, and the curves they trace.
 *
 * Removing edges one at a time and watching the network fall apart is a classic way to
 * find its modules. Two orders are offered, and they answer different questions:
 *
 *   - **Betweenness** (Girvan–Newman) removes the edge carrying the most shortest
 *     paths. It asks "where are the joins", and is blind to whether the evidence for
 *     an edge is any good.
 *   - **Trust-ascending** removes the least well-supported edge first. It asks the
 *     question a biologist actually has: what survives if I only believe the evidence?
 *
 * The second is the reason this module exists. Girvan–Newman on a PPI network finds
 * the joins in the *reported* network, which includes every one-paper screen hit;
 * peeling by trust finds the structure that would survive replication.
 */

import type { PpiGraph } from './graph'
import { connectedComponents } from './structure'

export interface RemovalStep {
  /** Edges removed so far. */
  readonly removed: number
  /** Connected components after this removal. */
  readonly components: number
  /** Size of the largest component, as a fraction of all nodes. */
  readonly largestComponentFraction: number
  /** Newtonian modularity of the current component partition. */
  readonly modularity: number
  /** The edge just removed, by index into the original graph. */
  readonly edge: number
  /** Its weight, so a trust-ordered run reads as a trust threshold. */
  readonly weight: number
}

export interface RemovalResult {
  readonly strategy: 'betweenness' | 'trust-ascending' | 'trust-descending'
  readonly steps: readonly RemovalStep[]
  /** Edges remaining at the step with the highest modularity. */
  readonly bestPartition: {
    readonly step: number
    readonly modularity: number
    readonly componentOf: readonly number[]
  }
}

export interface RemovalOptions {
  /** Stop after removing this many edges. */
  readonly maxRemovals?: number
  /** Recompute betweenness every N removals rather than every one. */
  readonly recomputeEvery?: number
  readonly signal?: AbortSignal
}

/**
 * Newman's modularity for a partition of an undirected graph.
 *
 * Positive means the partition has more edges inside groups than chance would give;
 * around zero means the partition explains nothing.
 */
export function modularity(
  graph: PpiGraph,
  componentOf: readonly number[],
  activeEdges: ReadonlySet<number>,
): number {
  const m = activeEdges.size
  if (m === 0) return 0

  const degree = new Array<number>(graph.order).fill(0)
  for (const index of activeEdges) {
    const edge = graph.edges[index]!
    degree[edge.source] = (degree[edge.source] ?? 0) + 1
    degree[edge.target] = (degree[edge.target] ?? 0) + 1
  }

  const internal = new Map<number, number>()
  const totalDegree = new Map<number, number>()

  for (const index of activeEdges) {
    const edge = graph.edges[index]!
    const a = componentOf[edge.source]!
    const b = componentOf[edge.target]!
    if (a === b) internal.set(a, (internal.get(a) ?? 0) + 1)
  }
  for (let node = 0; node < graph.order; node += 1) {
    const component = componentOf[node]!
    totalDegree.set(component, (totalDegree.get(component) ?? 0) + degree[node]!)
  }

  let q = 0
  for (const [component, inside] of internal) {
    const total = totalDegree.get(component) ?? 0
    q += inside / m - (total / (2 * m)) ** 2
  }
  // Components with no internal edges still contribute their degree penalty.
  for (const [component, total] of totalDegree) {
    if (!internal.has(component)) q -= (total / (2 * m)) ** 2
  }
  return q
}

/** Components of the graph restricted to a set of active edges. */
function componentsOf(
  graph: PpiGraph,
  activeEdges: ReadonlySet<number>,
): { componentOf: number[]; count: number; largest: number } {
  const componentOf = new Array<number>(graph.order).fill(-1)
  const adjacency: number[][] = graph.nodes.map(() => [])
  for (const index of activeEdges) {
    const edge = graph.edges[index]!
    adjacency[edge.source]!.push(edge.target)
    adjacency[edge.target]!.push(edge.source)
  }

  let count = 0
  let largest = 0
  for (let start = 0; start < graph.order; start += 1) {
    if (componentOf[start] !== -1) continue
    let size = 0
    const stack = [start]
    componentOf[start] = count
    while (stack.length > 0) {
      const node = stack.pop()!
      size += 1
      for (const neighbour of adjacency[node]!) {
        if (componentOf[neighbour] === -1) {
          componentOf[neighbour] = count
          stack.push(neighbour)
        }
      }
    }
    largest = Math.max(largest, size)
    count += 1
  }
  return { componentOf, count, largest }
}

/**
 * Edge betweenness by Brandes' algorithm, restricted to the active edges.
 *
 * O(nm), which is the cost of asking where a network's joins are. The caller controls
 * how often it is recomputed, because recomputing after every single removal — as the
 * original Girvan–Newman does — is what makes the method impractical at scale.
 */
export function edgeBetweenness(
  graph: PpiGraph,
  activeEdges: ReadonlySet<number>,
): Map<number, number> {
  const n = graph.order
  const adjacency: { node: number; edge: number }[][] = graph.nodes.map(() => [])
  for (const index of activeEdges) {
    const edge = graph.edges[index]!
    adjacency[edge.source]!.push({ node: edge.target, edge: index })
    adjacency[edge.target]!.push({ node: edge.source, edge: index })
  }

  const betweenness = new Map<number, number>()
  for (const index of activeEdges) betweenness.set(index, 0)

  for (let source = 0; source < n; source += 1) {
    if (adjacency[source]!.length === 0) continue

    const stack: number[] = []
    const predecessors: { node: number; edge: number }[][] = graph.nodes.map(() => [])
    const pathCount = new Array<number>(n).fill(0)
    const distance = new Array<number>(n).fill(-1)
    pathCount[source] = 1
    distance[source] = 0

    const queue: number[] = [source]
    let head = 0
    while (head < queue.length) {
      const node = queue[head]!
      head += 1
      stack.push(node)
      for (const { node: neighbour, edge } of adjacency[node]!) {
        if (distance[neighbour] === -1) {
          distance[neighbour] = distance[node]! + 1
          queue.push(neighbour)
        }
        if (distance[neighbour] === distance[node]! + 1) {
          pathCount[neighbour] = pathCount[neighbour]! + pathCount[node]!
          predecessors[neighbour]!.push({ node, edge })
        }
      }
    }

    const dependency = new Array<number>(n).fill(0)
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const node = stack[i]!
      for (const { node: parent, edge } of predecessors[node]!) {
        const share =
          (pathCount[parent]! / pathCount[node]!) * (1 + dependency[node]!)
        dependency[parent] = dependency[parent]! + share
        betweenness.set(edge, (betweenness.get(edge) ?? 0) + share)
      }
    }
  }

  // Each shortest path is counted from both endpoints.
  for (const [edge, value] of betweenness) betweenness.set(edge, value / 2)
  return betweenness
}

/** Remove edges in a chosen order, recording what happens to the network. */
export function removeEdges(
  graph: PpiGraph,
  strategy: RemovalResult['strategy'],
  options: RemovalOptions = {},
): RemovalResult {
  const maxRemovals = Math.min(options.maxRemovals ?? graph.size, graph.size)
  const recomputeEvery = Math.max(1, options.recomputeEvery ?? 1)

  const active = new Set<number>(graph.edges.map((_, index) => index))
  const steps: RemovalStep[] = []

  // Trust orders are static, so they are computed once rather than per step.
  const staticOrder =
    strategy === 'betweenness'
      ? null
      : [...active].sort((a, b) => {
          const wa = graph.edges[a]!.weight
          const wb = graph.edges[b]!.weight
          return strategy === 'trust-ascending' ? wa - wb || a - b : wb - wa || a - b
        })

  let best = { step: 0, modularity: -Infinity, componentOf: [] as number[] }
  let cachedBetweenness: Map<number, number> | null = null

  for (let removed = 0; removed < maxRemovals; removed += 1) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    let victim: number
    if (staticOrder) {
      victim = staticOrder[removed]!
    } else {
      if (cachedBetweenness === null || removed % recomputeEvery === 0) {
        cachedBetweenness = edgeBetweenness(graph, active)
      }
      victim = -1
      let bestValue = -Infinity
      for (const edge of active) {
        const value = cachedBetweenness.get(edge) ?? 0
        if (value > bestValue) {
          bestValue = value
          victim = edge
        }
      }
      if (victim === -1) break
      // Force a recompute next step if the cache is now stale in a way that matters.
      cachedBetweenness.delete(victim)
    }

    active.delete(victim)
    const { componentOf, count, largest } = componentsOf(graph, active)
    const q = modularity(graph, componentOf, active)

    steps.push({
      removed: removed + 1,
      components: count,
      largestComponentFraction: graph.order === 0 ? 0 : largest / graph.order,
      modularity: q,
      edge: victim,
      weight: graph.edges[victim]!.weight,
    })

    if (q > best.modularity) {
      best = { step: removed + 1, modularity: q, componentOf }
    }
  }

  if (best.componentOf.length === 0) {
    best = {
      step: 0,
      modularity: 0,
      componentOf: [...connectedComponents(graph).componentOf],
    }
  }
  return { strategy, steps, bestPartition: best }
}
