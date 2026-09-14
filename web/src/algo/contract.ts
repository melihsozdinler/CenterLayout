/**
 * High-level graph extraction: contracting a network to the structures inside it.
 *
 * This is the scalable answer to the hairball. A hundred thousand interactions cannot
 * be read as a node-link diagram at any layout quality; a hundred *modules*, with the
 * weight of evidence flowing between them, can. Each high-level node keeps the
 * membership that produced it, so any of it can be expanded back.
 */

import { louvain } from './community'
import type { PpiGraph } from './graph'
import { biconnectedComponents, connectedComponents, kCores, maximalCliques } from './structure'

export type GroupingStrategy =
  | 'connected-components'
  | 'biconnected-components'
  | 'communities'
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
  /** For `communities`, the modularity resolution. Higher gives smaller communities. */
  readonly resolution?: number
  /** Report and label as this strategy; for grouping computed elsewhere. */
  readonly labelAs?: GroupingStrategy
}

/** Group nodes by the chosen strategy, then contract. */
export function contract(
  graph: PpiGraph,
  options: ContractOptions = {},
): HighLevelGraph {
  const strategy = options.labelAs ?? options.strategy ?? 'connected-components'
  const minGroupSize = options.minGroupSize ?? 2

  const { groups, truncated } = groupsFor(
    graph,
    options.strategy ?? 'connected-components',
    options,
  )
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

/** The groups a strategy produces, before any contraction. May overlap. */
export function groupsFor(
  graph: PpiGraph,
  strategy: GroupingStrategy,
  options: ContractOptions = {},
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

    case 'communities': {
      const result = louvain(graph, {
        ...(options.resolution === undefined ? {} : { resolution: options.resolution }),
      })
      const byCommunity: number[][] = Array.from({ length: result.count }, () => [])
      result.communityOf.forEach((c, node) => byCommunity[c]!.push(node))
      return { groups: byCommunity, truncated: false }
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
        : strategy === 'communities'
          ? `Community ${index + 1}`
          : strategy === 'k-core'
            ? `Core ${index + 1}`
            : `Group ${index + 1}`

  return `${prefix}: ${named.join(', ')}${group.length > 3 ? ` +${group.length - 3}` : ''}`
}

/**
 * Below this many proteins, a network is drawn as proteins rather than contracted.
 *
 * Not a performance limit — a few hundred nodes render instantly. It is the size at
 * which a node-link diagram still says something, so contracting further would hide
 * structure the reader could have seen directly.
 */
export const DRAW_PROTEINS_BELOW = 240

/** Most modules worth drawing at once. Beyond this the high-level view is a hairball too. */
export const MAX_MODULES = 60

export interface AutoContractOptions {
  readonly maxModules?: number
  readonly resolution?: number
}

/**
 * Contract a graph by whichever grouping actually decomposes it.
 *
 * Biconnected components come first, because they are structural rather than
 * optimized: a module is a set of proteins that stay connected when any one of them is
 * removed, which is a statement about the network, not about a parameter. In a sparsely
 * studied organism this is most of the answer — on the coronavirus release, 724 of 880
 * interactions are bridges, so the decomposition is fine-grained and meaningful.
 *
 * But a well-studied core *is* biconnected, and then the decomposition returns it
 * unchanged: one module holding everything, which is no progress and, on a drill-down,
 * an infinite descent into the same picture. When that happens the graph is divided by
 * modularity instead, which always splits and can be applied again to the result.
 *
 * Note that biconnected components share articulation points, and a contracted node
 * claims each protein once — so an articulation protein appears in the first module
 * that claims it, not in every module it joins. Drilling into a module therefore shows
 * that module's proteins, not its boundary.
 */
export function autoContract(
  graph: PpiGraph,
  options: AutoContractOptions = {},
): HighLevelGraph {
  const maxModules = options.maxModules ?? MAX_MODULES

  const structural = groupsFor(graph, 'biconnected-components').groups.filter(
    (group) => group.length >= 2,
  )
  const sizes = structural.map((group) => group.length).sort((a, b) => b - a)
  const largest = sizes[0] ?? 0
  const second = sizes[1] ?? 0

  // "Decomposes" needs more than one module, no module that is essentially the whole
  // graph, and — the part that is easy to miss — a *second* module worth drawing.
  //
  // The human interactome fails on the last of these in a way the first two do not
  // catch: biconnected components split it into a core of 22,182 proteins and seven
  // thousand two-protein bridges, so the picture is one huge node ringed by specks.
  // That is a true statement about the network and a useless level to read it at.
  const decomposes =
    structural.length >= 2 &&
    largest < graph.order * 0.9 &&
    second >= Math.max(3, graph.order * 0.01)

  const groups = decomposes
    ? structural
    : groupsFor(graph, 'communities', {
        ...(options.resolution === undefined ? {} : { resolution: options.resolution }),
      }).groups

  // Minimum size 1, unlike the analytical contractions: a protein that ends up in no
  // module is still in the network, and dropping it would quietly shrink the picture
  // every time you drilled down. Along a chain of bridges most modules *are* single
  // proteins, and the fold below gathers that tail into one node rather than losing it.
  const contracted = contract(graph, {
    strategy: 'partition',
    partition: disjointPartition(graph, groups),
    minGroupSize: 1,
    labelAs: decomposes ? 'biconnected-components' : 'communities',
  })

  return foldSmallModules(contracted, maxModules)
}

/**
 * Turn possibly-overlapping groups into an assignment of one group per protein.
 *
 * Biconnected components share their articulation points, and a protein drawn as part
 * of two modules is counted twice, sized twice, and ambiguous to click on. Each protein
 * is therefore claimed by the largest group containing it — largest because the
 * alternative, first-listed, would let a two-protein bridge component steal a hub from
 * the complex it anchors. Proteins no group claims get a singleton, which the minimum
 * group size then drops into `ungrouped`.
 */
function disjointPartition(graph: PpiGraph, groups: readonly (readonly number[])[]): number[] {
  const ordered = groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => b.group.length - a.group.length || a.index - b.index)

  const assignment = new Array<number>(graph.order).fill(-1)
  let next = 0
  for (const { group } of ordered) {
    const unclaimed = group.filter((node) => assignment[node] === -1)
    if (unclaimed.length === 0) continue
    const id = next
    next += 1
    for (const node of unclaimed) assignment[node] = id
  }
  for (let node = 0; node < graph.order; node += 1) {
    if (assignment[node] === -1) {
      assignment[node] = next
      next += 1
    }
  }
  return assignment
}

/**
 * Fold the smallest modules into one, so the high-level graph stays readable.
 *
 * The same move the center layout makes with rarely-used methods, and for the same
 * reason: a long tail of two-protein modules fills the canvas with nodes too small to
 * read while hiding the modules that matter. The tail is kept as a single node rather
 * than dropped — it is still part of the network, and it can be opened.
 */
export function foldSmallModules(
  high: HighLevelGraph,
  maxModules: number,
): HighLevelGraph {
  if (high.nodes.length <= maxModules || maxModules < 2) return high

  const bySize = [...high.nodes].sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1))

  // Cut where the size actually changes, so equally sized modules share a fate. Taking
  // the largest `maxModules - 1` outright would, on a network whose tail is seven
  // thousand single proteins, keep fifty-nine of them for no reason anyone could state
  // and fold the rest.
  let cut = 0
  for (let k = 1; k <= maxModules - 1 && k < bySize.length; k += 1) {
    if (bySize[k - 1]!.size > bySize[k]!.size) cut = k
  }
  // Everything ties: no boundary exists, so keep the largest few and say so in the
  // label of what was folded.
  if (cut === 0) cut = maxModules - 1

  const keep = bySize.slice(0, cut)
  const folded = bySize.slice(cut)
  const foldedIds = new Set(folded.map((n) => n.id))

  const FOLD_ID = 'gsmall'
  const members = folded.flatMap((n) => [...n.members])
  const memberLabels = folded.flatMap((n) => [...n.memberLabels])

  let internalEdges = folded.reduce((sum, n) => sum + n.internalEdges, 0)
  let internalTrustMass = folded.reduce(
    (sum, n) => sum + (n.internalTrust ?? 0) * n.internalEdges,
    0,
  )

  const between = new Map<string, { count: number; trust: number }>()
  const add = (a: string, b: string, count: number, trust: number) => {
    const key = a < b ? `${a} ${b}` : `${b} ${a}`
    const existing = between.get(key)
    if (existing) {
      existing.count += count
      existing.trust += trust
    } else {
      between.set(key, { count, trust })
    }
  }

  for (const edge of high.edges) {
    const a = foldedIds.has(edge.source) ? FOLD_ID : edge.source
    const b = foldedIds.has(edge.target) ? FOLD_ID : edge.target
    if (a === FOLD_ID && b === FOLD_ID) {
      // Links between two folded modules are now inside the folded node.
      internalEdges += edge.edgeCount
      internalTrustMass += edge.trustMass
      continue
    }
    add(a, b, edge.edgeCount, edge.trustMass)
  }

  const foldedNode: HighLevelNode = {
    id: FOLD_ID,
    label: `${folded.length} small modules`,
    members,
    memberLabels,
    size: members.length,
    internalEdges,
    internalTrust: internalEdges === 0 ? null : internalTrustMass / internalEdges,
  }

  const nodes = [...keep, foldedNode]
  const present = new Set(nodes.map((n) => n.id))
  const edges: HighLevelEdge[] = [...between.entries()]
    .map(([key, value]) => {
      const [source, target] = key.split(' ') as [string, string]
      return { source, target, edgeCount: value.count, trustMass: value.trust }
    })
    .filter((e) => present.has(e.source) && present.has(e.target))
    .sort((a, b) => b.trustMass - a.trustMass)

  return { ...high, nodes, edges }
}
