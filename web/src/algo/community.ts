/**
 * Community detection by modularity optimization (Louvain).
 *
 * The other groupings in this directory are structural: a clique is a clique, a
 * biconnected component is a biconnected component, and either can be checked by hand.
 * Communities are not like that — they are the answer to "how would you divide this
 * network so that most of the evidence stays inside the parts", and the answer depends
 * on how you ask.
 *
 * That question is what a protein interaction network actually needs. Connected
 * components do not divide it at all: a PPI network is one giant component with a
 * fringe of isolates, so grouping by component puts 95% of the proteins in one group
 * and calls it structure. Biconnected components do better — they peel off the
 * tree-like periphery, and in a sparsely studied organism most interactions are
 * bridges — but a well-studied core is biconnected, so the decomposition returns it
 * unchanged. Neither can be applied recursively, which is what a drill-down needs.
 *
 * Modularity can. Louvain divides a dense core into parts, and each part can be
 * divided again.
 *
 * Weights are trust scores, so a community is held together by *evidence*, not merely
 * by edge count: a module resting on one paper each does not survive as a module.
 *
 * The implementation is deterministic. The published algorithm visits nodes in random
 * order, which makes runs differ; here the order is the node index and ties go to the
 * lowest community id, so the same graph always yields the same partition. A figure
 * that cannot be regenerated is not evidence.
 *
 * Blondel, Guillaume, Lambiotte & Lefebvre (2008), *Fast unfolding of communities in
 * large networks*, J. Stat. Mech. P10008.
 */

import type { PpiGraph } from './graph'

export interface CommunityOptions {
  /**
   * Resolution γ. Above 1 gives more, smaller communities; below 1 gives fewer, larger
   * ones. The default of 1 is the classical modularity, whose resolution limit means
   * modules smaller than about √(2m) edges tend to be merged — worth knowing before
   * concluding that two complexes are one.
   */
  readonly resolution?: number
  /** Stop after this many aggregation levels. */
  readonly maxLevels?: number
  /** Stop a level's local-moving phase after this many sweeps. */
  readonly maxPasses?: number
}

export interface CommunityResult {
  /** Community id per dense node index, numbered 0..count-1 by descending size. */
  readonly communityOf: readonly number[]
  readonly count: number
  /** Modularity of the returned partition, in [-1/2, 1]. */
  readonly modularity: number
  /** Aggregation levels actually performed. */
  readonly levels: number
}

interface Level {
  readonly n: number
  /** Neighbour index per node; a self-loop appears as its own index. */
  readonly adjacency: number[][]
  readonly weights: number[][]
  /** Weighted degree, self-loops counted twice, as modularity requires. */
  readonly degree: Float64Array
  readonly selfLoop: Float64Array
  /** 2m: the total weighted degree. */
  readonly total: number
}

function buildLevel(n: number, edges: readonly { u: number; v: number; w: number }[]): Level {
  const adjacency: number[][] = Array.from({ length: n }, () => [])
  const weights: number[][] = Array.from({ length: n }, () => [])
  const degree = new Float64Array(n)
  const selfLoop = new Float64Array(n)

  for (const { u, v, w } of edges) {
    if (u === v) {
      selfLoop[u] = selfLoop[u]! + w
      degree[u] = degree[u]! + 2 * w
      continue
    }
    adjacency[u]!.push(v)
    weights[u]!.push(w)
    adjacency[v]!.push(u)
    weights[v]!.push(w)
    degree[u] = degree[u]! + w
    degree[v] = degree[v]! + w
  }

  let total = 0
  for (let i = 0; i < n; i += 1) total += degree[i]!
  return { n, adjacency, weights, degree, selfLoop, total }
}

/**
 * One local-moving phase: repeatedly move each node to the neighbouring community that
 * most increases modularity, until a whole sweep moves nothing.
 */
function localMoving(level: Level, resolution: number, maxPasses: number): number[] {
  const { n, adjacency, weights, degree, total } = level
  const community = new Array<number>(n)
  const communityDegree = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    community[i] = i
    communityDegree[i] = degree[i]!
  }
  if (total === 0) return community

  // Reused across nodes so the inner loop allocates nothing; `touched` records which
  // entries need clearing, since zeroing the whole array per node would dominate.
  const linkTo = new Float64Array(n)
  const touched: number[] = []

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = 0

    for (let node = 0; node < n; node += 1) {
      const own = community[node]!
      const k = degree[node]!

      for (const c of touched) linkTo[c] = 0
      touched.length = 0

      const neighbours = adjacency[node]!
      const edgeWeights = weights[node]!
      for (let e = 0; e < neighbours.length; e += 1) {
        const c = community[neighbours[e]!]!
        if (linkTo[c] === 0) touched.push(c)
        linkTo[c] = linkTo[c]! + edgeWeights[e]!
      }

      // Remove the node before scoring, or its own degree inflates the penalty for
      // staying and every node drifts out of a community it should keep.
      communityDegree[own] = communityDegree[own]! - k

      let best = own
      let bestGain = linkTo[own]! - (resolution * communityDegree[own]! * k) / total

      for (const c of touched) {
        if (c === own) continue
        const gain = linkTo[c]! - (resolution * communityDegree[c]! * k) / total
        // Strictly greater, so a tie leaves the node where it is: with equal gains any
        // choice is as good, and churning between them costs a pass without progress.
        if (gain > bestGain || (gain === bestGain && c < best && best !== own)) {
          best = c
          bestGain = gain
        }
      }

      communityDegree[best] = communityDegree[best]! + k
      if (best !== own) {
        community[node] = best
        moved += 1
      }
    }

    if (moved === 0) break
  }

  return community
}

/** Renumber sparse community labels to a dense 0..k-1 range, in first-seen order. */
function densify(community: readonly number[]): { dense: number[]; count: number } {
  const map = new Map<number, number>()
  const dense = community.map((c) => {
    const existing = map.get(c)
    if (existing !== undefined) return existing
    const next = map.size
    map.set(c, next)
    return next
  })
  return { dense, count: map.size }
}

/** Modularity of a partition of the original graph, with trust as edge weight. */
export function modularity(
  graph: PpiGraph,
  communityOf: readonly number[],
  resolution = 1,
): number {
  const count = communityOf.length === 0 ? 0 : Math.max(...communityOf) + 1
  const inside = new Float64Array(count)
  const degree = new Float64Array(count)
  const nodeDegree = new Float64Array(graph.order)

  for (const edge of graph.edges) {
    const w = edge.weight
    nodeDegree[edge.source] = nodeDegree[edge.source]! + w
    nodeDegree[edge.target] = nodeDegree[edge.target]! + w
    if (communityOf[edge.source] === communityOf[edge.target]) {
      inside[communityOf[edge.source]!] = inside[communityOf[edge.source]!]! + 2 * w
    }
  }
  let total = 0
  for (let i = 0; i < graph.order; i += 1) {
    total += nodeDegree[i]!
    degree[communityOf[i]!] = degree[communityOf[i]!]! + nodeDegree[i]!
  }
  if (total === 0) return 0

  let q = 0
  for (let c = 0; c < count; c += 1) {
    q += inside[c]! / total - resolution * (degree[c]! / total) ** 2
  }
  return q
}

/**
 * Partition a graph into communities.
 *
 * Runs local moving, aggregates each community into a single node carrying the weight
 * inside it as a self-loop, and repeats on the smaller graph until a level stops
 * merging anything.
 */
export function louvain(
  graph: PpiGraph,
  options: CommunityOptions = {},
): CommunityResult {
  const resolution = options.resolution ?? 1
  const maxLevels = options.maxLevels ?? 12
  const maxPasses = options.maxPasses ?? 32

  if (graph.order === 0) {
    return { communityOf: [], count: 0, modularity: 0, levels: 0 }
  }

  let edges = graph.edges.map((e) => ({
    u: e.source,
    v: e.target,
    // Trust in [0,1] is the weight, but an edge of weight zero would be invisible to
    // modularity while still being a reported interaction, so it keeps a floor.
    w: Math.max(e.weight, 0.01),
  }))
  let size = graph.order
  // Original node -> community at the current level.
  let assignment = Array.from({ length: graph.order }, (_, i) => i)
  let levels = 0

  for (let level = 0; level < maxLevels; level += 1) {
    const built = buildLevel(size, edges)
    const moved = localMoving(built, resolution, maxPasses)
    const { dense, count } = densify(moved)
    levels = level + 1
    if (count === size) break

    assignment = assignment.map((c) => dense[c]!)

    // Aggregate: one node per community, inter-community weight summed, and the weight
    // inside a community kept as a self-loop so the next level scores it correctly.
    const merged = new Map<string, number>()
    for (const { u, v, w } of edges) {
      const a = dense[u]!
      const b = dense[v]!
      const key = a <= b ? `${a}:${b}` : `${b}:${a}`
      merged.set(key, (merged.get(key) ?? 0) + w)
    }
    edges = [...merged.entries()].map(([key, w]) => {
      const [a, b] = key.split(':')
      return { u: Number(a), v: Number(b), w }
    })
    size = count
  }

  // Number communities by descending size, so "community 1" is the biggest — a reader
  // should not have to sort them to find out which is which.
  const sizes = new Map<number, number>()
  for (const c of assignment) sizes.set(c, (sizes.get(c) ?? 0) + 1)
  const order = [...sizes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([c]) => c)
  const rank = new Map(order.map((c, index) => [c, index]))
  const communityOf = assignment.map((c) => rank.get(c)!)

  return {
    communityOf,
    count: rank.size,
    modularity: modularity(graph, communityOf, resolution),
    levels,
  }
}
