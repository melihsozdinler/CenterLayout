/**
 * Turning a center layout into a drawable scene.
 *
 * Kept separate from the layout itself so that the geometry — the part the paper
 * describes and the golden tests pin — never depends on colours, fonts or label
 * thresholds.
 */

import {
  AGGREGATE_SYSTEM_ID,
  ORGANISM_ID,
  type CenterLayoutResult,
  type LayoutNode,
} from '../center-layout'
import {
  PROLIVIS_STYLE,
  type Scene,
  type SceneItem,
  type SceneStyle,
} from './scene'

export interface CenterSceneOptions {
  readonly style?: SceneStyle
  /**
   * Label publications only when the layout is sparse enough for the labels to be
   * readable. A thousand overlapping author names is not information.
   */
  readonly labelPublicationsBelow?: number
  readonly showSystemLabels?: boolean
  /** Ids to draw emphasised; everything else fades back. */
  readonly highlight?: ReadonlySet<string>
  /** Padding around the layout's extent, in world units. */
  readonly padding?: number
}

const DEFAULTS = {
  labelPublicationsBelow: 60,
  showSystemLabels: true,
  padding: 120,
}

export function centerScene(
  layout: CenterLayoutResult,
  options: CenterSceneOptions = {},
): Scene {
  const style = options.style ?? PROLIVIS_STYLE
  const labelPublicationsBelow =
    options.labelPublicationsBelow ?? DEFAULTS.labelPublicationsBelow
  const showSystemLabels = options.showSystemLabels ?? DEFAULTS.showSystemLabels
  const padding = options.padding ?? DEFAULTS.padding
  const highlight = options.highlight

  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  const items: SceneItem[] = []

  // Edge ink has to fall as the graph grows. At a few hundred publications the default
  // weight reads as structure; at two thousand it reads as a red fog that hides the
  // nodes underneath.
  const edgeCount = layout.edges.length
  const density = Math.min(1, 400 / Math.max(1, edgeCount))
  const publicationEdgeWidth = 0.35 + 0.45 * density

  const dimmed = (id: string) => highlight !== undefined && !highlight.has(id)

  // --- edges, drawn first so nodes sit on top -------------------------------
  for (const edge of layout.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue

    const emphasised =
      highlight !== undefined && (highlight.has(edge.source) || highlight.has(edge.target))
    items.push({
      kind: 'line',
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
      stroke: emphasised ? style.edgeHighlight : style.edge,
      // Spokes from the centre carry more meaning than the many publication edges,
      // so they are drawn heavier.
      width: edge.kind === 'organism-system' ? 2.5 : publicationEdgeWidth,
    })
  }

  // --- nodes ----------------------------------------------------------------
  const publications = layout.nodes.filter((n) => n.kind === 'publication')
  const labelPublications = publications.length <= labelPublicationsBelow

  for (const node of layout.nodes) {
    items.push({
      kind: 'circle',
      id: node.id,
      x: node.x,
      y: node.y,
      radius: node.radius,
      fill: fillFor(node, style),
      stroke: 'rgba(0,0,0,0.28)',
      strokeWidth: 1,
      opacity: dimmed(node.id) ? 0.18 : node.kind === 'publication' ? 0.9 : 1,
    })
  }

  // --- labels ---------------------------------------------------------------
  const organism = byId.get(ORGANISM_ID)
  if (organism) {
    // Organism names run long ('Severe acute respiratory syndrome coronavirus 2').
    // Roughly half the font size per character; anything that will not fit inside the
    // node goes underneath it rather than spilling across the middle of the figure.
    const fontSize = 15
    const fits = organism.label.length * fontSize * 0.5 < organism.radius * 1.9
    items.push({
      kind: 'text',
      x: 0,
      y: fits ? 0 : organism.radius + fontSize,
      text: organism.label,
      fill: fits ? '#ffffff' : style.text,
      fontSize,
      anchor: 'middle',
      weight: 700,
    })
  }

  if (showSystemLabels) {
    for (const node of layout.nodes) {
      if (node.kind !== 'system' && node.kind !== 'aggregate') continue
      // Place the label just outside its node, along the spoke, flipped on the left
      // half so no text is ever upside down.
      const outward = node.distance + node.radius + 10
      const onLeft = Math.cos(node.angle) < 0
      items.push({
        kind: 'text',
        x: Math.cos(node.angle) * outward,
        y: Math.sin(node.angle) * outward,
        text: node.label,
        fill: style.text,
        fontSize: 13,
        anchor: onLeft ? 'end' : 'start',
        rotate: onLeft ? node.angle + Math.PI : node.angle,
        weight: 600,
      })
    }
  }

  if (labelPublications) {
    for (const node of publications) {
      const outward = node.distance + node.radius + 8
      const onLeft = Math.cos(node.angle) < 0
      items.push({
        kind: 'text',
        x: Math.cos(node.angle) * outward,
        y: Math.sin(node.angle) * outward,
        text: node.label,
        fill: style.textMuted,
        fontSize: 10,
        anchor: onLeft ? 'end' : 'start',
        rotate: onLeft ? node.angle + Math.PI : node.angle,
      })
    }
  }

  const reach = layout.extent + padding
  return {
    bounds: [-reach, -reach, reach, reach],
    items,
    background: style.background,
  }
}

function fillFor(node: LayoutNode, style: SceneStyle): string {
  switch (node.kind) {
    case 'organism':
      return style.organism
    case 'aggregate':
      return style.aggregate
    case 'system':
      return node.systemType === 'genetic' ? style.systemGenetic : style.system
    default:
      return style.publication
  }
}

/** The node at a world-space point, if any. Topmost (smallest) node wins. */
export function nodeAt(
  layout: CenterLayoutResult,
  x: number,
  y: number,
): LayoutNode | null {
  let best: LayoutNode | null = null
  for (const node of layout.nodes) {
    const distance = Math.hypot(node.x - x, node.y - y)
    // A generous tolerance on small nodes, which are otherwise near-impossible to hit.
    if (distance <= Math.max(node.radius, 6)) {
      if (!best || node.radius < best.radius) best = node
    }
  }
  return best
}

/** Ids to highlight when a node is selected: itself and everything it touches. */
export function neighbourhoodOf(
  layout: CenterLayoutResult,
  nodeId: string,
): Set<string> {
  const ids = new Set<string>([nodeId])
  for (const edge of layout.edges) {
    if (edge.source === nodeId) ids.add(edge.target)
    else if (edge.target === nodeId) ids.add(edge.source)
  }
  // Selecting the centre means the whole graph, which is the same as no selection.
  if (nodeId === ORGANISM_ID || nodeId === AGGREGATE_SYSTEM_ID) {
    for (const node of layout.nodes) ids.add(node.id)
  }
  return ids
}
