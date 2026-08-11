/**
 * Drawing the protein–protein network, and the adjacency matrix.
 *
 * Both emit the same surface-independent scene as the center layout, so both paint to
 * canvas for interaction and serialize to SVG for publication with no second code path.
 */

import type { NetworkLayoutResult, NetworkNode } from '../network-layout'
import type { MatrixView } from '../matrix'
import { PROLIVIS_STYLE, type Scene, type SceneItem, type SceneStyle } from './scene'

export type NetworkColouring = 'trust' | 'module' | 'degree'

export interface NetworkSceneOptions {
  readonly style?: SceneStyle
  readonly colourBy?: NetworkColouring
  /** Label nodes only when there is room for the labels to be read. */
  readonly labelBelow?: number
  readonly highlight?: ReadonlySet<number>
  readonly padding?: number
}

/**
 * Sequential ramp for trust, from unsupported to well-evidenced.
 *
 * Deliberately runs pale-grey to deep-blue rather than red-to-green: the point is that
 * low trust means *little evidence*, not *wrong*, and a red edge reads as an error.
 */
function trustColour(value: number, alpha: number): string {
  const t = Math.max(0, Math.min(1, value))
  const r = Math.round(196 - 140 * t)
  const g = Math.round(202 - 120 * t)
  const b = Math.round(210 - 20 * t)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Qualitative palette for modules; wraps rather than fading to indistinguishable. */
const MODULE_COLOURS = [
  '#3b4fd8', '#d8453c', '#1c9c6b', '#c9761f', '#7a52c9',
  '#0e8fa8', '#b3327a', '#6b8f1f', '#a8541c', '#4a5568',
]

export function networkScene(
  layout: NetworkLayoutResult,
  options: NetworkSceneOptions = {},
): Scene {
  const style = options.style ?? PROLIVIS_STYLE
  const colourBy = options.colourBy ?? 'trust'
  const labelBelow = options.labelBelow ?? 150
  const padding = options.padding ?? 80
  const highlight = options.highlight

  const items: SceneItem[] = []
  const nodes = layout.nodes
  const maxDegree = Math.max(1, ...nodes.map((n) => n.degree))

  // Edge ink falls as the graph grows, or a large network is a grey wash.
  const density = Math.min(1, 600 / Math.max(1, layout.edges.length))
  const baseWidth = 0.4 + 0.9 * density

  for (const edge of layout.edges) {
    const a = nodes[edge.source]
    const b = nodes[edge.target]
    if (!a || !b) continue
    const emphasised =
      highlight !== undefined &&
      (highlight.has(edge.source) || highlight.has(edge.target))
    const faded = highlight !== undefined && !emphasised

    items.push({
      kind: 'line',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke: trustColour(edge.weight, faded ? 0.05 : 0.28 + 0.5 * edge.weight),
      // Better-supported interactions are drawn heavier, so the evidence is legible
      // in the picture rather than only in the data.
      width: baseWidth * (0.5 + edge.weight),
    })
  }

  for (const node of nodes) {
    const faded = highlight !== undefined && !highlight.has(node.index)
    items.push({
      kind: 'circle',
      id: String(node.id),
      x: node.x,
      y: node.y,
      // Area with degree, so a hub is visibly a hub without swallowing the view.
      radius: 3 + 9 * Math.sqrt(node.degree / maxDegree),
      fill: nodeColour(node, colourBy, maxDegree, style),
      stroke: 'rgba(0,0,0,0.35)',
      strokeWidth: 0.8,
      opacity: faded ? 0.15 : 1,
    })
  }

  if (nodes.length <= labelBelow) {
    for (const node of nodes) {
      if (highlight !== undefined && !highlight.has(node.index)) continue
      items.push({
        kind: 'text',
        x: node.x,
        y: node.y - (3 + 9 * Math.sqrt(node.degree / maxDegree)) - 6,
        text: node.label,
        fill: style.text,
        fontSize: 11,
        anchor: 'middle',
        weight: 500,
      })
    }
  }

  const reach = layout.extent + padding
  return { bounds: [-reach, -reach, reach, reach], items, background: style.background }
}

function nodeColour(
  node: NetworkNode,
  colourBy: NetworkColouring,
  maxDegree: number,
  style: SceneStyle,
): string {
  if (colourBy === 'module') {
    return MODULE_COLOURS[node.group % MODULE_COLOURS.length] ?? style.system
  }
  if (colourBy === 'degree') {
    const t = Math.sqrt(node.degree / maxDegree)
    return `rgb(${Math.round(210 - 150 * t)}, ${Math.round(215 - 150 * t)}, ${Math.round(225 - 40 * t)})`
  }
  return style.system
}

/** The node nearest a world-space point, within its own radius. */
export function networkNodeAt(
  layout: NetworkLayoutResult,
  x: number,
  y: number,
): NetworkNode | null {
  const maxDegree = Math.max(1, ...layout.nodes.map((n) => n.degree))
  let best: NetworkNode | null = null
  let bestDistance = Infinity

  for (const node of layout.nodes) {
    const radius = Math.max(3 + 9 * Math.sqrt(node.degree / maxDegree), 6)
    const distance = Math.hypot(node.x - x, node.y - y)
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance
      best = node
    }
  }
  return best
}

/** A node and everything it interacts with. */
export function networkNeighbourhood(
  layout: NetworkLayoutResult,
  index: number,
): Set<number> {
  const ids = new Set<number>([index])
  for (const edge of layout.edges) {
    if (edge.source === index) ids.add(edge.target)
    else if (edge.target === index) ids.add(edge.source)
  }
  return ids
}

// --- matrix -----------------------------------------------------------------

export interface MatrixSceneOptions {
  readonly style?: SceneStyle
  readonly cellSize?: number
  /** Draw row and column labels when the matrix is small enough to read them. */
  readonly labelBelow?: number
}

/**
 * The adjacency matrix as a scene.
 *
 * Cell colour encodes trust. The diagonal is drawn faintly as a guide, since a matrix
 * without one is hard to read across.
 */
export function matrixScene(
  matrix: MatrixView,
  options: MatrixSceneOptions = {},
): Scene {
  const style = options.style ?? PROLIVIS_STYLE
  const n = matrix.labels.length
  const cell = options.cellSize ?? Math.max(3, Math.min(16, 900 / Math.max(1, n)))
  const labelBelow = options.labelBelow ?? 60
  const size = n * cell

  const items: SceneItem[] = []

  // Faint diagonal, as a reading guide.
  for (let i = 0; i < n; i += 1) {
    items.push({
      kind: 'line',
      x1: i * cell,
      y1: i * cell,
      x2: (i + 1) * cell,
      y2: (i + 1) * cell,
      stroke: 'rgba(120,130,145,0.25)',
      width: Math.max(0.5, cell * 0.08),
    })
  }

  // The matrix is symmetric, so each interaction is drawn on both sides: a triangular
  // plot is more compact but far harder to read a single protein's row from.
  for (const c of matrix.cells) {
    for (const [row, column] of [
      [c.row, c.column],
      [c.column, c.row],
    ] as const) {
      items.push({
        kind: 'circle',
        id: c.pairKey,
        x: column * cell + cell / 2,
        y: row * cell + cell / 2,
        radius: (cell / 2) * (0.45 + 0.55 * c.value),
        fill: trustColour(c.value, 0.95),
      })
    }
  }

  if (n <= labelBelow) {
    matrix.labels.forEach((label, i) => {
      items.push({
        kind: 'text',
        x: -8,
        y: i * cell + cell / 2,
        text: label,
        fill: style.textMuted,
        fontSize: Math.min(11, cell * 0.9),
        anchor: 'end',
      })
      items.push({
        kind: 'text',
        x: i * cell + cell / 2,
        y: -8,
        text: label,
        fill: style.textMuted,
        fontSize: Math.min(11, cell * 0.9),
        anchor: 'start',
        rotate: -Math.PI / 2,
      })
    })
  }

  const margin = n <= labelBelow ? 160 : 30
  return {
    bounds: [-margin, -margin, size + margin, size + margin],
    items,
    background: style.background,
  }
}
