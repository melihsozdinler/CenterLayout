/**
 * Laying out the high-level graph: modules as nodes, evidence as links.
 *
 * A hundred thousand interactions cannot be read as a node-link diagram at any layout
 * quality. Sixty modules can, and each one can be opened. This is the same drawing
 * machinery as the protein network — the modules are laid out by the force embedding,
 * so the arrangement means the same thing it always does — but a node is now a set of
 * proteins and an edge is the evidence spanning two sets.
 *
 * What each channel encodes, since a reader has to be able to trust that:
 *
 *   - node area   ∝ proteins in the module
 *   - node ring   — how much evidence holds the module together internally
 *   - edge width  ∝ interactions spanning the two modules
 *   - edge colour — the mean trust of those interactions
 *
 * Modules with no external link are placed on an outer ring rather than dropped. A
 * module that connects to nothing at this trust threshold is a finding, not an error.
 */

import type { HighLevelGraph } from '../algo/contract'
import { PpiGraph } from '../algo/graph'
import type { ScoredPair } from '../trust/score'
import { networkLayout } from './network-layout'

export interface HighLevelLayoutNode {
  readonly index: number
  readonly id: string
  readonly label: string
  readonly x: number
  readonly y: number
  /** Proteins in this module. */
  readonly size: number
  /** Modules this one links to. */
  readonly degree: number
  readonly internalEdges: number
  readonly internalTrust: number | null
  readonly members: readonly number[]
  readonly memberLabels: readonly string[]
}

export interface HighLevelLayoutEdge {
  readonly source: number
  readonly target: number
  /** Protein interactions spanning the two modules. */
  readonly edgeCount: number
  /** Summed trust of those interactions. */
  readonly trustMass: number
  /** Mean trust, which is what the colour encodes. */
  readonly trust: number
}

export interface HighLevelLayoutResult {
  readonly nodes: readonly HighLevelLayoutNode[]
  readonly edges: readonly HighLevelLayoutEdge[]
  readonly extent: number
  /** Proteins covered by the drawn modules. */
  readonly proteinCount: number
  /** Proteins in no module at all, e.g. isolates under a structural grouping. */
  readonly ungrouped: number
}

export interface HighLevelLayoutOptions {
  readonly radius?: number
  readonly seed?: number
}

export function highLevelLayout(
  high: HighLevelGraph,
  options: HighLevelLayoutOptions = {},
): HighLevelLayoutResult {
  const radius = options.radius ?? 460
  const indexOf = new Map(high.nodes.map((node, index) => [node.id, index]))

  const degree = new Array<number>(high.nodes.length).fill(0)
  const edges: HighLevelLayoutEdge[] = []
  for (const edge of high.edges) {
    const source = indexOf.get(edge.source)
    const target = indexOf.get(edge.target)
    if (source === undefined || target === undefined || source === target) continue
    degree[source] = degree[source]! + 1
    degree[target] = degree[target]! + 1
    edges.push({
      source,
      target,
      edgeCount: edge.edgeCount,
      trustMass: edge.trustMass,
      trust: edge.edgeCount === 0 ? 0 : edge.trustMass / edge.edgeCount,
    })
  }

  // Borrow the protein-network force layout by handing it the module graph: a module
  // becomes a node whose id is its index and whose edge weight is the mean trust
  // spanning the pair, so better-evidenced module links pull harder — exactly as
  // better-evidenced interactions do one level down.
  const pairs: ScoredPair[] = edges.map((edge) => ({
    pairKey: `${String(edge.source).padStart(6, '0')}:${String(edge.target).padStart(6, '0')}`,
    score: Math.max(0.01, Math.min(1, edge.trust)),
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
    nodeLo: Math.min(edge.source, edge.target),
    nodeHi: Math.max(edge.source, edge.target),
    symbolLo: high.nodes[Math.min(edge.source, edge.target)]?.label ?? '',
    symbolHi: high.nodes[Math.max(edge.source, edge.target)]?.label ?? '',
  }))

  const placed = new Map<number, { x: number; y: number }>()
  if (pairs.length > 0) {
    const graph = PpiGraph.fromPairs(pairs)
    const layout = networkLayout(graph, {
      mode: 'force',
      radius,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    })
    for (const node of layout.nodes) placed.set(node.id, { x: node.x, y: node.y })
  }

  // Anything the force layout never saw — a module linked to nothing — goes on a ring
  // outside the drawing, in size order.
  const orphans = high.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ index }) => !placed.has(index))
  if (orphans.length > 0) {
    const spread = Math.max(
      radius * 1.15,
      [...placed.values()].reduce((max, p) => Math.max(max, Math.hypot(p.x, p.y)), 0) * 1.2,
    )
    orphans
      .sort((a, b) => b.node.size - a.node.size || a.index - b.index)
      .forEach(({ index }, position) => {
        const angle = (position / orphans.length) * Math.PI * 2 - Math.PI / 2
        placed.set(index, { x: Math.cos(angle) * spread, y: Math.sin(angle) * spread })
      })
  }

  const nodes: HighLevelLayoutNode[] = high.nodes.map((node, index) => {
    const position = placed.get(index) ?? { x: 0, y: 0 }
    return {
      index,
      id: node.id,
      label: node.label,
      x: position.x,
      y: position.y,
      size: node.size,
      degree: degree[index]!,
      internalEdges: node.internalEdges,
      internalTrust: node.internalTrust,
      members: node.members,
      memberLabels: node.memberLabels,
    }
  })

  const extent = nodes.reduce((max, node) => Math.max(max, Math.hypot(node.x, node.y)), 1)

  return {
    nodes,
    edges,
    extent,
    proteinCount: nodes.reduce((sum, node) => sum + node.size, 0),
    ungrouped: high.ungrouped.length,
  }
}
