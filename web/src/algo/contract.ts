/**
 * High-level graph extraction: contracting a network to the structures inside it.
 *
 * This is the scalable answer to the hairball. A hundred thousand interactions cannot
 * be read as a node-link diagram at any layout quality; a hundred *modules*, with the
 * weight of evidence flowing between them, can. Each high-level node keeps the
 * membership that produced it, so any of it can be expanded back.
 */

import type { PpiGraph } from './graph'
import { biconnectedComponents, connectedComponents, kCores, maximalCliques } from './structure'

export type GroupingStrategy =
  | 'connected-components'
  | 'biconnected-components'
  | 'cliques'
  | 'k-core'
  | 'partition'

export interface HighLevelNode {
  readonly id: string
  readonly label: string
  /** BioGRID gene ids in this group. */
  readonly members: readonly number[]
  readonly memberLabels: readonly string[]
  readonly size: number
  /** Edges wholly inside this group. */
  readonly internalEdges: number
  /** Mean trust of the internal edges, or null when there are none. */
  readonly internalTrust: number | null
}

export interface HighLevelEdge {
  readonly source: string
  readonly target: string
  /** Original edges spanning the two groups. */
  readonly edgeCount: number
  /** Summed trust across those edges: how much evidence connects the modules. */
  readonly trustMass: number
}

export interface HighLevelGraph {
  readonly strategy: GroupingStrategy
  readonly nodes: readonly HighLevelNode[]
  readonly edges: readonly HighLevelEdge[]
  /** Nodes not assigned to any group, e.g. singletons under a clique grouping. */
  readonly ungrouped: readonly number[]
  readonly truncated: boolean
}

export interface ContractOptions {
  readonly strategy?: GroupingStrategy
  /** Discard groups smaller than this. */
  readonly minGroupSize?: number
  /** For `k-core`, the k to extract. Defaults to the maximum core. */
  readonly k?: number
  /** For `partition`, an explicit group index per node. */
  readonly partition?: readonly number[]
  readonly maxCliques?: number
}

/** Group nodes by the chosen strategy, then contract. */
export function contract(
  graph: PpiGraph,
  options: ContractOptions = {},
): HighLevelGraph {
  const strategy = options.strategy ?? 'connected-components'
  const minGroupSize = options.minGroupSize ?? 2

  const { groups, truncated } = groupNodes(graph, strategy, options)
  const kept = groups.filter((g) => g.length >= minGroupSize)

  // A node may belong to several cliques; the first group wins for edge attribution so
  // that trust mass is counted once rather than multiplied across overlaps.
  const groupOf = new Map<number, number>()
  kept.forEach((group, index) => {
    for (const node of group) if (!groupOf.has(node)) groupOf.set(node, index)
  })

  const internalEdges = new Array<number>(kept.length).fill(0)
  const internalTrust = new Array<number>(kept.length).fill(0)
  const between = new Map<string, { count: number; trust: number }>()

  for (const edge of graph.edges) {
    const a = groupOf.get(edge.source)
    const b = groupOf.get(edge.target)
    if (a === undefined || b === undefined) continue

    if (a === b) {
      internalEdges[a] = internalEdges[a]! + 1
      internalTrust[a] = internalTrust[a]! + edge.weight
      continue
    }
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const existing = between.get(key)
    if (existing) {
      existing.count += 1
      existing.trust += edge.weight
    } else {
      between.set(key, { count: 1, trust: edge.weight })
    }
  }

  const nodes: HighLevelNode[] = kept.map((group, index) => ({
    id: `g${index}`,
    label: labelFor(strategy, index, group, graph),
    members: group.map((n) => graph.nodes[n]!.id),
    memberLabels: group.map((n) => graph.label(n)),
    size: group.length,
    internalEdges: internalEdges[index]!,
    internalTrust:
      internalEdges[index]! === 0 ? null : internalTrust[index]! / internalEdges[index]!,
  }))

  const edges: HighLevelEdge[] = [...between.entries()]
    .map(([key, value]) => {
      const [a, b] = key.split(':').map(Number)
      return {
        source: `g${a}`,
        target: `g${b}`,
        edgeCount: value.count,
        trustMass: value.trust,
      }
    })
    .sort((a, b) => b.trustMass - a.trustMass)

  const ungrouped: number[] = []
  for (let node = 0; node < graph.order; node += 1) {
    if (!groupOf.has(node)) ungrouped.push(graph.nodes[node]!.id)
  }

  return { strategy, nodes, edges, ungrouped, truncated }
}

function groupNodes(
  graph: PpiGraph,
  strategy: GroupingStrategy,
  options: ContractOptions,
): { groups: number[][]; truncated: boolean } {
  switch (strategy) {
    case 'connected-components':
      return { groups: connectedComponents(graph).members.map((m) => [...m]), truncated: false }

    case 'biconnected-components': {
      // Biconnected components are sets of *edges*; the group is their endpoints.
      const result = biconnectedComponents(graph)
      const groups = result.components.map((component) => {
        const nodes = new Set<number>()
        for (const index of component) {
          const edge = graph.edges[index]!
          nodes.add(edge.source)
          nodes.add(edge.target)
        }
        return [...nodes].sort((a, b) => a - b)
      })
      return { groups, truncated: false }
    }

    case 'cliques': {
      const result = maximalCliques(graph, {
        minSize: Math.max(3, options.minGroupSize ?? 3),
        ...(options.maxCliques === undefined ? {} : { maxCliques: options.maxCliques }),
      })
      return { groups: result.cliques.map((c) => [...c]), truncated: result.truncated }
    }

    case 'k-core': {
      const cores = kCores(graph)
      const k = options.k ?? cores.maxCore
      const keep = new Set<number>()
      cores.coreness.forEach((c, index) => {
        if (c >= k) keep.add(index)
      })
      // The k-core is one set; its connected pieces are the meaningful groups.
      const sub = graph.induced(keep)
      const components = connectedComponents(sub)
      const groups = components.members.map((member) =>
        [...member]
          .map((index) => graph.index(sub.nodes[index]!.id))
          .filter((i): i is number => i !== undefined)
          .sort((a, b) => a - b),
      )
      return { groups, truncated: false }
    }

    case 'partition': {
      const partition = options.partition
      if (!partition) {
        throw new Error("The 'partition' strategy requires a partition array")
      }
      const byGroup = new Map<number, number[]>()
      partition.forEach((group, node) => {
        const list = byGroup.get(group)
        if (list) list.push(node)
        else byGroup.set(group, [node])
      })
      return {
        groups: [...byGroup.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, members]) => members),
        truncated: false,
      }
    }
  }
}

/** A label a reader can act on: the biggest members, not just a group number. */
function labelFor(
  strategy: GroupingStrategy,
  index: number,
  group: readonly number[],
  graph: PpiGraph,
): string {
  const named = [...group]
    .sort((a, b) => graph.degree(b) - graph.degree(a))
    .slice(0, 3)
    .map((n) => graph.label(n))

  const prefix =
    strategy === 'cliques'
      ? `Clique ${index + 1}`
      : strategy === 'biconnected-components'
        ? `Module ${index + 1}`
        : strategy === 'k-core'
          ? `Core ${index + 1}`
          : `Group ${index + 1}`

  return `${prefix}: ${named.join(', ')}${group.length > 3 ? ` +${group.length - 3}` : ''}`
}
