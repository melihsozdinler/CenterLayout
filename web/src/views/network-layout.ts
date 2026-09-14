/**
 * Layouts for the protein–protein network itself.
 *
 * The center layout shows a literature; this shows the interactions. Three modes,
 * because no single one is right for a PPI network at every size:
 *
 *   - `force`   — the familiar spring embedding. Best under a few thousand nodes.
 *   - `grouped` — trust-weighted communities on a ring, members within each. Scales
 *                 further and makes module structure explicit rather than hoping it
 *                 emerges.
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
import { louvain } from '../algo/community'

export type NetworkLayoutMode = 'force' | 'grouped' | 'circular' | 'ego' | 'layered'

export interface NetworkLayoutOptions {
  readonly mode?: NetworkLayoutMode
  /** Fixed rather than run-to-convergence, so the result is reproducible. */
  readonly iterations?: number
  readonly seed?: number
  /** Target radius of the drawing. */
  readonly radius?: number
  /** Pull toward the centre; higher values make a tighter ball. */
  readonly gravity?: number
  /** Group index per node, for `grouped`. Defaults to trust-weighted communities. */
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

  // Communities, not connected components. A PPI network is one giant component, so
  // grouping by component put every protein in a single group and drew one disc —
  // which is also what the force layout fell back to above its size cap, so the two
  // buttons produced the same picture. Trust-weighted communities are what "grouped"
  // promises: modules held together by evidence.
  const groups = o.groups ?? [...louvain(graph).communityOf]
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
        : mode === 'layered'
          ? layeredPositions(graph, o.radius, o.focus)
          : mode === 'circular'
            ? circularPositions(graph, o.radius)
            : mode === 'grouped'
              ? groupedPositions(graph, groups)
              : forceByComponent(graph, o)

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
 * Layered drawing, in the Sugiyama style adapted to an undirected graph.
 *
 * A PPI network has no direction to layer by, so layers come from graph distance to a
 * root — the highest-degree protein, or the focus when there is one. That makes the
 * vertical axis mean "hops from here", which is the reading a biologist wants when
 * asking how a signal could get from one protein to another: every edge that matters
 * runs downward, and a long horizontal edge is visibly a shortcut.
 *
 * Within a layer, order is set by the barycentre heuristic swept up and down until it
 * stops improving. Minimising crossings exactly is NP-hard; barycentre is the standard
 * approximation and removes most of them in a handful of passes.
 */
function layeredPositions(graph: PpiGraph, radius: number, focus?: number) {
  const x = new Float64Array(graph.order)
  const y = new Float64Array(graph.order)
  if (graph.order === 0) return { x, y }

  // Root: the focus if the view has one, otherwise the best-connected protein — the
  // layering is only meaningful relative to something, and a hub is the most useful
  // default vantage point.
  let root = focus ?? 0
  if (focus === undefined) {
    let best = -1
    for (let i = 0; i < graph.order; i += 1) {
      if (graph.degree(i) > best) {
        best = graph.degree(i)
        root = i
      }
    }
  }

  // Layer = distance from the root. Components the root cannot reach are layered from
  // their own best-connected member and appended below, rather than dropped.
  const layerOf = new Array<number>(graph.order).fill(-1)
  const assign = (start: number, offset: number): number => {
    let deepest = offset
    layerOf[start] = offset
    let frontier = [start]
    while (frontier.length > 0) {
      const next: number[] = []
      for (const node of frontier) {
        for (const neighbour of graph.adjacency[node]!) {
          if (layerOf[neighbour] === -1) {
            layerOf[neighbour] = layerOf[node]! + 1
            deepest = Math.max(deepest, layerOf[neighbour]!)
            next.push(neighbour)
          }
        }
      }
      frontier = next
    }
    return deepest
  }

  let deepest = assign(root, 0)
  for (let i = 0; i < graph.order; i += 1) {
    if (layerOf[i] === -1) deepest = assign(i, deepest + 2)
  }

  const layers: number[][] = Array.from({ length: deepest + 1 }, () => [])
  for (let i = 0; i < graph.order; i += 1) layers[layerOf[i]!]!.push(i)
  // Seed each layer by degree so the first barycentre sweep starts somewhere sensible.
  for (const layer of layers) {
    layer.sort((a, b) => graph.degree(b) - graph.degree(a) || a - b)
  }

  // Barycentre sweeps: order each layer by the mean position of its neighbours in the
  // adjacent layer, alternating direction. Stops when a full pass changes nothing.
  const positionIn = new Array<number>(graph.order).fill(0)
  const reindex = () => {
    for (const layer of layers) {
      layer.forEach((node, index) => {
        positionIn[node] = index
      })
    }
  }
  reindex()

  const sweep = (from: number, to: number, step: number): boolean => {
    let changed = false
    for (let level = from; level !== to; level += step) {
      const target = level + step
      if (target < 0 || target >= layers.length) break
      const layer = layers[target]!
      const before = layer.join(',')

      const barycentre = new Map<number, number>()
      for (const node of layer) {
        const anchors = graph.adjacency[node]!.filter((nb) => layerOf[nb] === level)
        barycentre.set(
          node,
          anchors.length === 0
            ? // No anchor in the reference layer: keep its current place rather than
              // collapsing every such node onto zero, which would pile them together.
              positionIn[node]!
            : anchors.reduce((sum, nb) => sum + positionIn[nb]!, 0) / anchors.length,
        )
      }
      layer.sort(
        (a, b) => barycentre.get(a)! - barycentre.get(b)! || positionIn[a]! - positionIn[b]!,
      )
      if (layer.join(',') !== before) changed = true
      reindex()
    }
    return changed
  }

  for (let pass = 0; pass < 12; pass += 1) {
    const down = sweep(0, layers.length - 1, 1)
    const up = sweep(layers.length - 1, 0, -1)
    if (!down && !up) break
  }

  const widest = Math.max(1, ...layers.map((l) => l.length))
  const width = radius * 2
  const height = radius * 1.6
  // Minimum horizontal gap between adjacent nodes; below this a layer reads as a
  // solid line rather than as proteins.
  const nodeSpacing = 11
  const perRow = Math.max(4, Math.floor(width / nodeSpacing))

  // A layer wider than the canvas wraps into sub-rows. At organism scale a single
  // hop from a hub can hold a thousand proteins, and a hop is still one layer — so
  // the rows stay grouped and the vertical axis keeps meaning hops, with thickness.
  const rowsIn = layers.map((layer) => Math.max(1, Math.ceil(layer.length / perRow)))
  const totalRows = rowsIn.reduce((sum, r) => sum + r, 0)
  const rowGap = height / Math.max(1, totalRows - 1)

  let row = 0
  layers.forEach((layer, level) => {
    const rows = rowsIn[level]!
    const inRow = Math.ceil(layer.length / rows)

    layer.forEach((node, index) => {
      const rowIndex = Math.floor(index / inRow)
      const positionInRow = index % inRow
      const countInRow = Math.min(inRow, layer.length - rowIndex * inRow)

      // Spread over a width proportional to how full the row is, so a two-node row
      // is not stretched across the whole drawing.
      const span = width * Math.min(1, countInRow / Math.min(widest, perRow))
      const t = countInRow === 1 ? 0.5 : positionInRow / (countInRow - 1)
      x[node] = -span / 2 + t * span
      y[node] = -height / 2 + (row + rowIndex) * rowGap
    })
    row += rows
  })

  return { x, y }
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
 * Communities as discs, packed around the largest, members arranged inside each.
 *
 * Makes module structure explicit rather than hoping a force layout reveals it, and
 * stays legible at sizes where a spring embedding turns into a single blob.
 */
function groupedPositions(graph: PpiGraph, groups: readonly number[]) {
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

  // Members sit on concentric rings a fixed slot apart, the centre first. The slot is
  // chosen from the size of the whole network: small networks are drawn with labels,
  // and a slot tuned for thousands of proteins drew a fifty-protein network so tight
  // that, once the view zoomed to fit, every label sat on top of its neighbour.
  const slot = graph.order <= 200 ? 46 : graph.order <= 1000 ? 30 : 22
  const capacity = (ring: number) => (ring === 0 ? 1 : Math.max(1, Math.floor(2 * Math.PI * ring)))
  const ringsFor = (size: number) => {
    let placed = 0
    let ring = 0
    while (placed < size) {
      placed += capacity(ring)
      ring += 1
    }
    return ring - 1
  }

  // Packed rather than spaced around a fixed ring. A ring of fixed radius sized each
  // sector by share, which let a large community's disc run over its neighbours' —
  // communities drawn on top of each other are not communities anyone can read. The
  // packer guarantees no two discs overlap, and puts the largest at the centre.
  const centres = packDiscs(
    ordered.map(([, list]) => ringsFor(list.length) * slot + slot / 2 + NODE_MARGIN),
  )

  for (const [position, [, list]] of ordered.entries()) {
    const { x: cx, y: cy } = centres[position]!
    // Best-connected at the centre, so the hub of a community is where the eye lands.
    const sorted = [...list].sort((a, b) => graph.degree(b) - graph.degree(a) || a - b)
    let index = 0
    for (let ring = 0; index < sorted.length; ring += 1) {
      const count = Math.min(capacity(ring), sorted.length - index)
      for (let j = 0; j < count; j += 1) {
        const node = sorted[index + j]!
        // Alternate rings are offset by half a slot, so nodes do not line up radially.
        const angle = ((j + (ring % 2) * 0.5) / count) * Math.PI * 2 - Math.PI / 2
        x[node] = cx + Math.cos(angle) * ring * slot
        y[node] = cy + Math.sin(angle) * ring * slot
      }
      index += count
    }
  }
  return { x, y }
}

/**
 * The force layout, one connected component at a time, then packed.
 *
 * A component with no edge to the rest feels only repulsion from it, so under a
 * single embedding it drifts outward until gravity balances — far outside the main
 * component. Fitting the view to include it then shrinks everything else, which on a
 * sparse network means the picture is mostly empty canvas with the interesting part
 * reduced to a smudge in the middle.
 *
 * So each component gets its own embedding, sized by its share of the proteins so the
 * density is the same throughout, and the components are packed: the largest at the
 * centre, the rest in rings around it, largest first, each one placed where it fits.
 * Distance between components now means nothing — which is honest, because there is
 * no interaction between them for it to mean anything about.
 *
 * A single-component graph is laid out exactly as before.
 */
function forceByComponent(
  graph: PpiGraph,
  o: Required<Pick<NetworkLayoutOptions, 'iterations' | 'seed' | 'radius' | 'gravity'>>,
) {
  const components = connectedComponents(graph)
  if (components.count <= 1) return forcePositions(graph, o)

  const n = graph.order
  const x = new Float64Array(n)
  const y = new Float64Array(n)

  // Each component laid out on its own, centred on its own origin.
  const pieces = components.members.map((members) => {
    if (members.length === 1) {
      return { members, px: [0], py: [0], reach: NODE_MARGIN }
    }
    const keep = new Set(members)
    const sub = graph.induced(keep)
    const local = forcePositions(sub, {
      ...o,
      // Radius with the square root of the share, so area is proportional to size and
      // a two-protein component is not drawn at the scale of the whole network.
      radius: Math.max(NODE_MARGIN * 2, o.radius * Math.sqrt(members.length / n)),
    })
    // Map back to this graph's indices by protein id: `induced` re-indexes densely.
    const px: number[] = []
    const py: number[] = []
    const order: number[] = []
    let sx = 0
    let sy = 0
    for (let j = 0; j < sub.order; j += 1) {
      const index = graph.index(sub.nodes[j]!.id)
      if (index === undefined) continue
      order.push(index)
      px.push(local.x[j]!)
      py.push(local.y[j]!)
      sx += local.x[j]!
      sy += local.y[j]!
    }
    // Recentre on the centroid, so the packing below places what it thinks it places.
    const mx = sx / Math.max(1, px.length)
    const my = sy / Math.max(1, py.length)
    let reach = NODE_MARGIN
    for (let j = 0; j < px.length; j += 1) {
      px[j] = px[j]! - mx
      py[j] = py[j]! - my
      reach = Math.max(reach, Math.hypot(px[j]!, py[j]!) + NODE_MARGIN)
    }
    return { members: order, px, py, reach }
  })

  const centres = packDiscs(pieces.map((piece) => piece.reach))
  pieces.forEach((piece, c) => {
    const centre = centres[c]!
    piece.members.forEach((index, j) => {
      x[index] = centre.x + piece.px[j]!
      y[index] = centre.y + piece.py[j]!
    })
  })
  return { x, y }
}

/** Clearance around a node, and between packed components. */
const NODE_MARGIN = 14

/**
 * Place discs of the given radii without overlap: the first at the origin, the rest on
 * rings around it, in the order given (largest first), each ring filled before the
 * next is started. Deterministic and O(n) in the number of discs.
 *
 * Each ring's discs are spread evenly around it. Packed from twelve o'clock instead,
 * a handful of small components filled a third of the ring and read as a tail hanging
 * off one side of the network — a shape that means nothing, since there is no
 * interaction between components for their placement to describe.
 */
export function packDiscs(radii: readonly number[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = radii.map(() => ({ x: 0, y: 0 }))
  if (radii.length <= 1) return out

  const gap = NODE_MARGIN
  // First assign discs to rings, then place each ring's discs.
  const rings: { radius: number; members: { index: number; need: number }[] }[] = []
  let inner = radii[0]! + gap // Everything placed so far lies within this radius.
  let current: (typeof rings)[number] | null = null
  let used = 0
  let width = 0

  for (let i = 1; i < radii.length; i += 1) {
    const r = radii[i]!
    for (;;) {
      if (current === null) {
        current = { radius: inner + r, members: [] }
        rings.push(current)
        used = 0
        width = r
      }
      // Angle this disc needs on the ring: the chord of its diameter, plus a gap.
      const need = 2 * Math.asin(Math.min(1, (r + gap / 2) / current.radius))
      if (used + need <= Math.PI * 2 - 1e-9 || current.members.length === 0) {
        current.members.push({ index: i, need })
        used += need
        width = Math.max(width, r)
        break
      }
      // Ring full: the next starts outside everything on this one.
      inner = current.radius + width + gap
      current = null
    }
  }

  for (const ring of rings) {
    const total = ring.members.reduce((sum, m) => sum + m.need, 0)
    // Spare arc shared equally between the discs, so the ring is balanced.
    const spare = Math.max(0, Math.PI * 2 - total) / ring.members.length
    let angle = -Math.PI / 2
    for (const member of ring.members) {
      const at = angle + member.need / 2
      out[member.index] = { x: Math.cos(at) * ring.radius, y: Math.sin(at) * ring.radius }
      angle += member.need + spare
    }
  }
  return out
}

/**
 * Largest graph a force layout is used on; above it `networkLayout` falls back to the
 * grouped arrangement.
 *
 * This was 1,200 while repulsion was exact, and at default settings a coronavirus
 * organism is 1,800 proteins — so pressing Force drew Grouped, and nobody could tell
 * why the two buttons looked alike. Barnes–Hut repulsion makes a few thousand nodes a
 * second's work, so the cap now sits where the picture stops saying anything rather
 * than where the arithmetic got slow.
 */
export const MAX_FORCE_NODES = 6000

/**
 * Below this, repulsion is exact. Small layouts — every figure in the paper and the
 * supplement, and the golden tests — stay byte-identical to what they were.
 *
 * Measured rather than guessed: at a thousand proteins Barnes–Hut takes 0.3 s and the
 * exact computation 1.9 s, so exact is kept only where it is cheap anyway.
 */
export const EXACT_REPULSION_BELOW = 300

/** Barnes–Hut opening angle: a cell farther than size/θ is treated as one mass. */
const THETA = 0.8

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

  // One quadtree for the whole layout, rebuilt in place each iteration.
  const tree = n < EXACT_REPULSION_BELOW ? null : new QuadTree(n)

  for (let step = 0; step < o.iterations; step += 1) {
    dx.fill(0)
    dy.fill(0)

    if (tree === null) {
      exactRepulsion(x, y, dx, dy, n, k)
    } else {
      barnesHutRepulsion(x, y, dx, dy, n, k, tree)
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

/** Repulsion between every pair, computed once per pair and applied to both. */
export function exactRepulsion(
  x: Float64Array,
  y: Float64Array,
  dx: Float64Array,
  dy: Float64Array,
  n: number,
  k: number,
): void {
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
}

/**
 * Barnes–Hut repulsion: O(n log n) per iteration instead of O(n²).
 *
 * A quadtree over the current positions; a cell far enough away relative to its size
 * repels as one mass at its centre. This is the approximation that keeps long-range
 * forces smooth. The earlier grid scheme cut them off at a cell boundary instead, gave
 * every node the same repulsion radius, and settled into a visible lattice — which is
 * why repulsion went exact in the first place.
 *
 * Built and traversed in index order with explicit stacks, so the result is
 * deterministic and no recursion depth depends on the data. Exported so a test can hold
 * it against the exact computation.
 *
 * Pass the same `tree` across iterations: a layout is two hundred and fifty of these,
 * and allocating the quadtree afresh each time was most of the cost.
 */
export function barnesHutRepulsion(
  x: Float64Array,
  y: Float64Array,
  dx: Float64Array,
  dy: Float64Array,
  n: number,
  k: number,
  tree: QuadTree = new QuadTree(n),
): void {
  tree.build(x, y, n)
  const { mass, cx, cy, size, left, top, child, kids, point, pointCell } = tree
  const k2 = k * k
  const stack = tree.stack

  for (let i = 0; i < n; i += 1) {
    const xi = x[i]!
    const yi = y[i]!
    let fx = 0
    let fy = 0

    let depth = 0
    stack[depth++] = 0
    while (depth > 0) {
      const cell = stack[--depth]!
      const m = mass[cell]!
      if (m === 0) continue

      const leaf = kids[cell] === 0
      if (leaf && m === 1 && point[cell] === i) continue

      let ddx = xi - cx[cell]!
      let ddy = yi - cy[cell]!
      let distance = Math.sqrt(ddx * ddx + ddy * ddy)

      // A cell containing the point itself is never summarised: its centre of mass can
      // sit far enough away to pass the opening test, and the point would then repel
      // itself as part of the cell.
      const s = size[cell]!
      const l = left[cell]!
      const t = top[cell]!
      const inside = xi >= l && xi < l + s && yi >= t && yi < t + s

      if (leaf || (!inside && s < THETA * distance)) {
        const others = leaf && pointCell[i] === cell ? m - 1 : m
        if (others <= 0) continue
        if (distance < 0.01) {
          ddx = ((i % 7) - 3) * 0.01 + 0.001
          ddy = ((cell % 7) - 3) * 0.01 + 0.001
          distance = Math.sqrt(ddx * ddx + ddy * ddy)
        }
        const force = (others * k2) / (distance * distance)
        fx += ddx * force
        fy += ddy * force
        continue
      }

      const base = cell * 4
      for (let q = 3; q >= 0; q -= 1) {
        const c = child[base + q]!
        if (c !== -1) stack[depth++] = c
      }
    }

    dx[i] = dx[i]! + fx
    dy[i] = dy[i]! + fy
  }
}

/** Maximum subdivision depth; points closer than this share a leaf. */
const MAX_DEPTH = 24

/**
 * A quadtree held in typed arrays, rebuilt in place.
 *
 * Cells are indices; children are four slots per cell, -1 when absent. A point that
 * reaches MAX_DEPTH shares its leaf rather than subdividing without end, which only
 * happens for points that are, to floating-point precision, in the same place.
 */
export class QuadTree {
  mass: Float64Array
  cx: Float64Array
  cy: Float64Array
  size: Float64Array
  left: Float64Array
  top: Float64Array
  child: Int32Array
  /** Children present, so a leaf test is one read rather than four. */
  kids: Uint8Array
  /** The first point stored in a leaf, or -1. */
  point: Int32Array
  /** The leaf each point ended in: answers "is this point in that leaf" in O(1). */
  pointCell: Int32Array
  stack: Int32Array
  private cells = 0

  constructor(n: number) {
    const capacity = Math.max(64, n * 4 + 64)
    this.mass = new Float64Array(capacity)
    this.cx = new Float64Array(capacity)
    this.cy = new Float64Array(capacity)
    this.size = new Float64Array(capacity)
    this.left = new Float64Array(capacity)
    this.top = new Float64Array(capacity)
    this.child = new Int32Array(capacity * 4).fill(-1)
    this.kids = new Uint8Array(capacity)
    this.point = new Int32Array(capacity).fill(-1)
    this.pointCell = new Int32Array(Math.max(1, n))
    this.stack = new Int32Array(capacity * 4)
  }

  private grow(): void {
    const next = this.mass.length * 2
    const f64 = (a: Float64Array) => {
      const b = new Float64Array(next)
      b.set(a)
      return b
    }
    this.mass = f64(this.mass)
    this.cx = f64(this.cx)
    this.cy = f64(this.cy)
    this.size = f64(this.size)
    this.left = f64(this.left)
    this.top = f64(this.top)
    const child = new Int32Array(next * 4).fill(-1)
    child.set(this.child)
    this.child = child
    const kids = new Uint8Array(next)
    kids.set(this.kids)
    this.kids = kids
    const point = new Int32Array(next).fill(-1)
    point.set(this.point)
    this.point = point
    this.stack = new Int32Array(next * 4)
  }

  private makeCell(l: number, t: number, s: number): number {
    if (this.cells >= this.mass.length) this.grow()
    const c = this.cells
    this.cells += 1
    this.mass[c] = 0
    this.cx[c] = 0
    this.cy[c] = 0
    this.left[c] = l
    this.top[c] = t
    this.size[c] = s
    this.kids[c] = 0
    this.point[c] = -1
    this.child.fill(-1, c * 4, c * 4 + 4)
    return c
  }

  build(x: Float64Array, y: Float64Array, n: number): void {
    if (this.pointCell.length < n) this.pointCell = new Int32Array(n)

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < n; i += 1) {
      const px = x[i]!
      const py = y[i]!
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
    const side = Math.max(maxX - minX, maxY - minY, 1e-6) * 1.0001

    this.cells = 0
    this.makeCell(minX, minY, side)

    for (let i = 0; i < n; i += 1) {
      const px = x[i]!
      const py = y[i]!
      let cell = 0
      for (let depth = 0; ; depth += 1) {
        const m = this.mass[cell]!
        this.cx[cell] = (this.cx[cell]! * m + px) / (m + 1)
        this.cy[cell] = (this.cy[cell]! * m + py) / (m + 1)
        this.mass[cell] = m + 1

        const leaf = this.kids[cell] === 0
        if (leaf && m === 0) {
          this.point[cell] = i
          this.pointCell[i] = cell
          break
        }
        if (depth >= MAX_DEPTH) {
          // Coincident: share the leaf.
          this.pointCell[i] = cell
          break
        }
        if (leaf) {
          // Push the resident point one level down before descending.
          const resident = this.point[cell]!
          this.point[cell] = -1
          const c = this.childFor(cell, x[resident]!, y[resident]!)
          this.mass[c] = 1
          this.cx[c] = x[resident]!
          this.cy[c] = y[resident]!
          this.point[c] = resident
          this.pointCell[resident] = c
        }
        cell = this.childFor(cell, px, py)
      }
    }
  }

  private childFor(cell: number, px: number, py: number): number {
    const half = this.size[cell]! / 2
    const l = this.left[cell]!
    const t = this.top[cell]!
    const q = (px >= l + half ? 1 : 0) + (py >= t + half ? 2 : 0)
    const slot = cell * 4 + q
    const existing = this.child[slot]!
    if (existing !== -1) return existing
    const c = this.makeCell(l + (q & 1 ? half : 0), t + (q & 2 ? half : 0), half)
    // makeCell may have grown the arrays; write through `this`, not a stale local.
    this.child[slot] = c
    this.kids[cell] = this.kids[cell]! + 1
    return c
  }
}
