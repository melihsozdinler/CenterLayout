/**
 * Adjacency matrix and UpSet views.
 *
 * A node-link diagram of a dense PPI network is a hairball at any layout quality; a
 * matrix is not. Every cell is a fixed size and never overlaps, so a matrix shows a
 * hundred times more interactions legibly — at the cost of making paths hard to trace,
 * which is why both views exist rather than one.
 *
 * The ordering is what makes a matrix readable. Rows in arbitrary order look like
 * noise; rows ordered so that connected proteins sit near each other put complexes on
 * the diagonal as visible blocks.
 */

import type { ScoredPair } from '../trust/score'
import { PpiGraph } from '../algo/graph'
import { connectedComponents, kCores } from '../algo/structure'

/** ASCII unit separator: it cannot occur in a method name, so keys are exact. */
const SEP = String.fromCharCode(0x1f)

export type MatrixOrdering = 'degree' | 'core' | 'component' | 'cluster' | 'alphabetical'

export interface MatrixCell {
  readonly row: number
  readonly column: number
  /** Trust score of this interaction. */
  readonly value: number
  readonly pairKey: string
}

export interface MatrixView {
  /** Protein labels in display order. */
  readonly labels: readonly string[]
  /** BioGRID gene ids, parallel to `labels`. */
  readonly ids: readonly number[]
  /** Cells above the diagonal only; the matrix is symmetric. */
  readonly cells: readonly MatrixCell[]
  readonly ordering: MatrixOrdering
  /** True when the view was capped and shows only the busiest proteins. */
  readonly truncated: boolean
}

export interface MatrixOptions {
  readonly ordering?: MatrixOrdering
  /**
   * Cap the number of proteins shown. A matrix is legible up to a few hundred rows;
   * beyond that the cells fall below a pixel and the view stops informing.
   */
  readonly maxNodes?: number
}

export function buildMatrix(
  pairs: readonly ScoredPair[],
  options: MatrixOptions = {},
): MatrixView {
  const ordering = options.ordering ?? 'cluster'
  const maxNodes = options.maxNodes ?? 300

  const graph = PpiGraph.fromPairs(pairs)
  const order = orderNodes(graph, ordering)

  const truncated = order.length > maxNodes
  const shown = order.slice(0, maxNodes)
  const position = new Map<number, number>()
  shown.forEach((node, index) => position.set(node, index))

  const cells: MatrixCell[] = []
  for (const edge of graph.edges) {
    const a = position.get(edge.source)
    const b = position.get(edge.target)
    if (a === undefined || b === undefined) continue
    cells.push({
      row: Math.min(a, b),
      column: Math.max(a, b),
      value: edge.weight,
      pairKey: edge.pairKey,
    })
  }

  return {
    labels: shown.map((n) => graph.label(n)),
    ids: shown.map((n) => graph.nodes[n]!.id),
    cells,
    ordering,
    truncated,
  }
}

function orderNodes(graph: PpiGraph, ordering: MatrixOrdering): number[] {
  const all = [...Array(graph.order).keys()]

  switch (ordering) {
    case 'alphabetical':
      return all.sort((a, b) => (graph.label(a) < graph.label(b) ? -1 : 1))

    case 'degree':
      return all.sort((a, b) => graph.degree(b) - graph.degree(a) || a - b)

    case 'core': {
      const cores = kCores(graph)
      return all.sort(
        (a, b) =>
          cores.coreness[b]! - cores.coreness[a]! ||
          graph.degree(b) - graph.degree(a) ||
          a - b,
      )
    }

    case 'component': {
      const components = connectedComponents(graph)
      return all.sort(
        (a, b) =>
          components.componentOf[a]! - components.componentOf[b]! ||
          graph.degree(b) - graph.degree(a) ||
          a - b,
      )
    }

    case 'cluster':
      return clusterOrder(graph)
  }
}

/**
 * Seriation by breadth-first traversal within components, largest component first,
 * visiting the highest-degree neighbour first.
 *
 * Cheap and effective: it puts each connected module in a contiguous block and, within
 * a module, keeps densely linked proteins adjacent, so complexes appear as blocks on
 * the diagonal. Spectral seriation orders slightly better but needs an eigenvector,
 * which is a poor trade for a view the user re-orders interactively.
 */
function clusterOrder(graph: PpiGraph): number[] {
  const components = connectedComponents(graph)
  const order: number[] = []
  const visited = new Array<boolean>(graph.order).fill(false)

  for (const component of components.members) {
    const seeds = [...component].sort(
      (a, b) => graph.degree(b) - graph.degree(a) || a - b,
    )
    for (const seed of seeds) {
      if (visited[seed]) continue
      visited[seed] = true
      const queue = [seed]
      let head = 0
      while (head < queue.length) {
        const node = queue[head]!
        head += 1
        order.push(node)
        const neighbours = [...graph.adjacency[node]!].sort(
          (a, b) => graph.degree(b) - graph.degree(a) || a - b,
        )
        for (const neighbour of neighbours) {
          if (!visited[neighbour]) {
            visited[neighbour] = true
            queue.push(neighbour)
          }
        }
      }
    }
  }
  return order
}

// --- UpSet ------------------------------------------------------------------

export interface UpSetIntersection {
  /** Experimental systems in this combination, sorted. */
  readonly systems: readonly string[]
  /** Interactions supported by exactly this combination. */
  readonly count: number
}

export interface UpSetView {
  /** Systems by total interaction count, most used first. */
  readonly systems: readonly { name: string; total: number }[]
  /** Combinations, largest first. */
  readonly intersections: readonly UpSetIntersection[]
  readonly totalInteractions: number
}

export interface PairSystems {
  readonly pairKey: string
  readonly systems: readonly string[]
}

/**
 * Which combinations of experimental methods actually co-occur.
 *
 * A Venn diagram cannot show more than three or four sets; an UpSet plot shows all of
 * them. The question it answers matters for the trust model: if two methods almost
 * never appear together, an interaction supported by both is far better evidence than
 * the raw counts suggest.
 */
export function buildUpSet(
  pairs: readonly PairSystems[],
  options: { maxIntersections?: number; minCount?: number } = {},
): UpSetView {
  const maxIntersections = options.maxIntersections ?? 30
  const minCount = options.minCount ?? 1

  const systemTotals = new Map<string, number>()
  const combinations = new Map<string, { systems: string[]; count: number }>()

  for (const pair of pairs) {
    const systems = [...new Set(pair.systems)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (systems.length === 0) continue

    for (const system of systems) {
      systemTotals.set(system, (systemTotals.get(system) ?? 0) + 1)
    }
    const key = systems.join(SEP)
    const existing = combinations.get(key)
    if (existing) existing.count += 1
    else combinations.set(key, { systems, count: 1 })
  }

  return {
    systems: [...systemTotals.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1)),
    intersections: [...combinations.values()]
      .filter((c) => c.count >= minCount)
      .sort((a, b) => b.count - a.count || a.systems.length - b.systems.length)
      .slice(0, maxIntersections),
    totalInteractions: pairs.length,
  }
}
