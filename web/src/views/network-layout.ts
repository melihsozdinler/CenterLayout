/**
 * Layouts for the protein–protein network itself.
 *
 * The center layout shows a literature; this shows the interactions. Three modes,
 * because no single one is right for a PPI network at every size:
 *
 *   - `force`   — the familiar spring embedding. Best under a few thousand nodes.
 *   - `grouped` — modules on a ring, members within each. Scales further and makes
 *                 module structure explicit rather than hoping it emerges.
 *   - `circular` — everything on one ring, ordered so neighbours are adjacent. Honest
 *                 about being a reference view rather than a picture of structure.
 *
 * All three are **deterministic**. The force layout uses a seeded generator and a
 * fixed iteration count rather than running to convergence, so the same graph always
 * produces the same picture — the property ProLiVis 1.0 lacked, and the one that makes
 * a figure reproducible from a manifest.
 */

import type { PpiGraph } from '../algo/graph'
import { connectedComponents } from '../algo/structure'

export type NetworkLayoutMode = 'force' | 'grouped' | 'circular' | 'ego'

export interface NetworkLayoutOptions {
  readonly mode?: NetworkLayoutMode
  /** Fixed rather than run-to-convergence, so the result is reproducible. */
  readonly iterations?: number
  readonly seed?: number
  /** Target radius of the drawing. */
  readonly radius?: number
  /** Pull toward the centre; higher values make a tighter ball. */
  readonly gravity?: number
  /** Group index per node, for `grouped`. Defaults to connected components. */
  readonly groups?: readonly number[]
  /**
   * Dense index of the protein to centre an `ego` layout on. Its partners form the
   * first ring, their partners the second, and so on outward by graph distance.
   */
  readonly focus?: number
}

export interface NetworkNode {
  readonly index: number
  readonly id: number
  readonly label: string
  readonly x: number
  readonly y: number
  readonly degree: number
  readonly group: number
}

export interface NetworkEdgeLine {
  readonly source: number
  readonly target: number
  readonly weight: number
  readonly pairKey: string
}

export interface NetworkLayoutResult {
  readonly mode: NetworkLayoutMode
  readonly nodes: readonly NetworkNode[]
  readonly edges: readonly NetworkEdgeLine[]
  readonly extent: number
  readonly groupCount: number
}

const DEFAULTS = {
  mode: 'force' as NetworkLayoutMode,
  iterations: 250,
  seed: 0x5eed,
  radius: 520,
  gravity: 0.06,
}

/** Seeded PRNG. A layout that consults Math.random cannot be reproduced. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function networkLayout(
  graph: PpiGraph,
  options: NetworkLayoutOptions = {},
): NetworkLayoutResult {
  const o = { ...DEFAULTS, ...options }
  const n = graph.order

  const groups =
    o.groups ?? [...connectedComponents(graph).componentOf]
  const groupCount = new Set(groups).size

  // Force is only used where it can say something; beyond that the grouped
  // arrangement is both faster and more informative, so fall back rather than
  // producing an expensive blob.
  const mode: NetworkLayoutMode =
    o.mode === 'ego' && o.focus === undefined
      ? 'force'
      : o.mode === 'force' && n > MAX_FORCE_NODES
        ? 'grouped'
        : o.mode

  const positions =
    n === 0
      ? { x: new Float64Array(0), y: new Float64Array(0) }
      : mode === 'ego' && o.focus !== undefined
        ? egoPositions(graph, o.focus, o.radius)
        : mode === 'circular'
          ? circularPositions(graph, o.radius)
          : mode === 'grouped'
            ? groupedPositions(graph, groups, o.radius)
            : forcePositions(graph, o)

  const nodes: NetworkNode[] = graph.nodes.map((node, index) => ({
    index,
    id: node.id,
    label: node.label,
    x: positions.x[index] ?? 0,
    y: positions.y[index] ?? 0,
    degree: graph.degree(index),
    group: groups[index] ?? 0,
  }))

  const edges: NetworkEdgeLine[] = graph.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
    pairKey: edge.pairKey,
  }))

  const extent = nodes.reduce((max, node) => Math.max(max, Math.hypot(node.x, node.y)), 1)
  return { mode, nodes, edges, extent, groupCount }
}

/**
 * One protein at the centre, its partners on the first ring, theirs on the second.
 *
 * This is the answer to "show me everything this protein interacts with". Radius is
 * graph distance from the focus, so the picture states how each protein is reached
 * rather than leaving it to be traced; within a ring, proteins are ordered by the
 * partner that introduced them, keeping each sub-branch contiguous.
 */
function egoPositions(graph: PpiGraph, focus: number, radius: number) {
  const x = new Float64Array(graph.order)
  const y = new Float64Array(graph.order)

  // Breadth-first from the focus: distance is the ring, and the order of discovery
  // keeps each first-ring partner's own neighbours adjacent to it.
  const distance = new Array<number>(graph.order).fill(-1)
  const rings: number[][] = []
  distance[focus] = 0
  rings.push([focus])

  let frontier = [focus]
  while (frontier.length > 0) {
    const next: number[] = []
    for (const node of frontier) {
      for (const neighbour of graph.adjacency[node]!) {
        if (distance[neighbour] === -1) {
          distance[neighbour] = distance[node]! + 1
          next.push(neighbour)
        }
      }
    }
    if (next.length > 0) rings.push(next)
    frontier = next
  }

  // Anything unreachable — a filter can disconnect the graph — goes to an outer ring
  // rather than being dropped or piled on the origin.
  const unreachable = [...Array(graph.order).keys()].filter((i) => distance[i] === -1)
  if (unreachable.length > 0) rings.push(unreachable)

  const spacing = radius / Math.max(1, rings.length)
  // Minimum arc between adjacent nodes. Below this they merge into a solid band and
  // the ring stops being readable as individual proteins.
  const nodeSpacing = 13

  rings.forEach((ring, level) => {
    if (level === 0) {
      x[ring[0]!] = 0
      y[ring[0]!] = 0
      return
    }

    // A hub can have a thousand partners, which will not fit on one circle at any
    // legible spacing. Split the ring into concentric bands within its own level
    // rather than letting the nodes overlap — radius still means graph distance,
    // just with a little thickness.
    const inner = spacing * level
    const capacity = Math.max(1, Math.floor((2 * Math.PI * inner) / nodeSpacing))
    const bands = Math.max(1, Math.ceil(ring.length / capacity))
    const bandGap = bands === 1 ? 0 : (spacing * 0.7) / bands

    let placed = 0
    for (let band = 0; band < bands && placed < ring.length; band += 1) {
      const r = inner + band * bandGap
      const bandCapacity = Math.max(1, Math.floor((2 * Math.PI * r) / nodeSpacing))
      const count = Math.min(bandCapacity, ring.length - placed)
      for (let i = 0; i < count; i += 1) {
        const node = ring[placed + i]!
        // Offset alternate bands by half a slot so nodes do not line up radially.
        const angle =
          ((i + (band % 2) * 0.5) / count) * Math.PI * 2 - Math.PI / 2
        x[node] = Math.cos(angle) * r
        y[node] = Math.sin(angle) * r
      }
      placed += count
    }
  })
  return { x, y }
}

/** Everything on one ring, ordered by a traversal so neighbours sit together. */
function circularPositions(graph: PpiGraph, radius: number) {
  const components = connectedComponents(graph)
  const order: number[] = []
  const visited = new Array<boolean>(graph.order).fill(false)

  for (const component of components.members) {
    const seeds = [...component].sort((a, b) => graph.degree(b) - graph.degree(a) || a - b)
    for (const seed of seeds) {
      if (visited[seed]) continue
      visited[seed] = true
      const queue = [seed]
      let head = 0
      while (head < queue.length) {
        const node = queue[head]!
        head += 1
        order.push(node)
        for (const neighbour of graph.adjacency[node]!) {
          if (!visited[neighbour]) {
            visited[neighbour] = true
            queue.push(neighbour)
          }
        }
      }
    }
  }

  const x = new Float64Array(graph.order)
  const y = new Float64Array(graph.order)
  order.forEach((node, position) => {
    const angle = (position / order.length) * Math.PI * 2 - Math.PI / 2
    x[node] = Math.cos(angle) * radius
    y[node] = Math.sin(angle) * radius
  })
  return { x, y }
}

/**
 * Modules on a ring, members packed inside each.
 *
 * Makes module structure explicit rather than hoping a force layout reveals it, and
 * stays legible at sizes where a spring embedding turns into a single blob.
 */
function groupedPositions(
  graph: PpiGraph,
  groups: readonly number[],
  radius: number,
) {
  const members = new Map<number, number[]>()
  groups.forEach((group, node) => {
    const list = members.get(group)
    if (list) list.push(node)
    else members.set(group, [node])
  })

  // Largest groups first, so the eye lands on the substantial modules.
  const ordered = [...members.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0] - b[0],
  )

  const x = new Float64Array(graph.order)
  const y = new Float64Array(graph.order)
  const total = ordered.reduce((sum, [, list]) => sum + list.length, 0) || 1

  let angleCursor = -Math.PI / 2
  for (const [, list] of ordered) {
    const share = list.length / total
    const sectorWidth = Math.max(share * Math.PI * 2, 0.05)
    const centreAngle = angleCursor + sectorWidth / 2
    // Group radius grows with membership so dense modules are not overdrawn.
    const groupRadius = 18 + 14 * Math.sqrt(list.length)
    const cx = Math.cos(centreAngle) * radius
    const cy = Math.sin(centreAngle) * radius

    const sorted = [...list].sort((a, b) => graph.degree(b) - graph.degree(a) || a - b)
    sorted.forEach((node, index) => {
      if (sorted.length === 1) {
        x[node] = cx
        y[node] = cy
        return
      }
      // Concentric rings inside the group, densest at the centre.
      const ring = Math.floor(Math.sqrt(index))
      const inRing = Math.max(1, 2 * ring + 1)
      const positionInRing = index - ring * ring
      const angle = (positionInRing / inRing) * Math.PI * 2
      const r = (ring / Math.sqrt(sorted.length)) * groupRadius
      x[node] = cx + Math.cos(angle) * r
      y[node] = cy + Math.sin(angle) * r
    })
    angleCursor += sectorWidth
  }
  return { x, y }
}

/**
 * Largest graph a force layout is used on. Above this the picture stops conveying
 * structure long before it stops computing, and `networkLayout` falls back to the
 * grouped arrangement rather than drawing a blob.
 */
export const MAX_FORCE_NODES = 1200

/**
 * Fruchterman–Reingold with exact repulsion.
 *
 * Exact, not approximated. An earlier version bucketed nodes into a grid and repelled
 * only within neighbouring cells, which is the standard way to make this tractable —
 * but the hard cutoff at a cell boundary gives every node the same repulsion radius,
 * and the layout settles into a visible lattice. Approximating long-range forces needs
 * a quadtree to be smooth; a grid is not good enough.
 *
 * So repulsion is O(n²) per iteration, and the node count is capped instead. At the
 * cap that is 1200² × 250 ≈ 360M operations, around a second, which is acceptable for
 * a layout computed once rather than animated.
 */
function forcePositions(
  graph: PpiGraph,
  o: Required<Pick<NetworkLayoutOptions, 'iterations' | 'seed' | 'radius' | 'gravity'>>,
) {
  const n = graph.order
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)

  const random = mulberry32(o.seed)
  const area = Math.PI * o.radius * o.radius
  const k = Math.sqrt(area / Math.max(1, n))

  // Seeded ring start: deterministic, and a ring spreads faster than a random cloud.
  for (let i = 0; i < n; i += 1) {
    const angle = (i / n) * Math.PI * 2
    const jitter = 0.6 + random() * 0.8
    x[i] = Math.cos(angle) * o.radius * jitter
    y[i] = Math.sin(angle) * o.radius * jitter
  }

  const initialTemperature = o.radius / 6
  let temperature = initialTemperature

  for (let step = 0; step < o.iterations; step += 1) {
    dx.fill(0)
    dy.fill(0)

    // Repulsion between every pair, computed once per pair and applied to both.
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let ddx = x[i]! - x[j]!
        let ddy = y[i]! - y[j]!
        let distance = Math.hypot(ddx, ddy)
        if (distance < 0.01) {
          // Coincident nodes need a nudge, and a deterministic one.
          ddx = ((i % 7) - 3) * 0.01 + 0.001
          ddy = ((j % 7) - 3) * 0.01 + 0.001
          distance = Math.hypot(ddx, ddy)
        }
        const force = (k * k) / distance
        const fx = (ddx / distance) * force
        const fy = (ddy / distance) * force
        dx[i] = dx[i]! + fx
        dy[i] = dy[i]! + fy
        dx[j] = dx[j]! - fx
        dy[j] = dy[j]! - fy
      }
    }

    // Attraction along edges, weighted by trust: better-supported interactions pull
    // harder, so the well-evidenced core draws together.
    for (const edge of graph.edges) {
      const ddx = x[edge.source]! - x[edge.target]!
      const ddy = y[edge.source]! - y[edge.target]!
      const distance = Math.hypot(ddx, ddy) || 0.01
      const force = ((distance * distance) / k) * (0.4 + 0.6 * edge.weight)
      const fx = (ddx / distance) * force
      const fy = (ddy / distance) * force
      dx[edge.source] = dx[edge.source]! - fx
      dy[edge.source] = dy[edge.source]! - fy
      dx[edge.target] = dx[edge.target]! + fx
      dy[edge.target] = dy[edge.target]! + fy
    }

    // Gravity keeps disconnected components from drifting off the canvas.
    for (let i = 0; i < n; i += 1) {
      dx[i] = dx[i]! - x[i]! * o.gravity * k * 0.01
      dy[i] = dy[i]! - y[i]! * o.gravity * k * 0.01
    }

    for (let i = 0; i < n; i += 1) {
      const displacement = Math.hypot(dx[i]!, dy[i]!) || 1
      const limited = Math.min(displacement, temperature)
      x[i] = x[i]! + (dx[i]! / displacement) * limited
      y[i] = y[i]! + (dy[i]! / displacement) * limited
    }

    // Linear cooling on a fixed schedule, computed from the step rather than
    // multiplied into the previous value: compounding a shrinking factor collapses the
    // temperature within a few steps and freezes the layout where it started.
    temperature = initialTemperature * (1 - step / o.iterations) + o.radius / 500
  }

  return { x, y }
}
