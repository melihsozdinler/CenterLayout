/**
 * Center Layout 2.0 — the layout ProLiVis exists for, made deterministic.
 *
 * The 1.0 idea, recovered from `dialog.cpp:492-536` and the published figures, is a
 * two-level star: the organism at the centre, one node per experimental system around
 * it, and one node per publication hanging off the system that produced it. It shows
 * a field's literature at a glance — which methods the community actually uses, and
 * who used them.
 *
 * Two things were wrong with the original, and both are fixed here rather than
 * reproduced:
 *
 *  1. **Publications were assigned one arbitrary method.** The 1.0 query grouped by
 *     publication and took whatever experimental system SQLite happened to return, so
 *     a paper reporting three assays was silently filed under one of them. Here a
 *     publication belongs to *all* its systems, and is placed at the circular mean of
 *     them with an edge to each.
 *
 *  2. **Coordinates were outsourced.** 1.0 shelled out to a force-directed binary
 *     (`ProlivisAuto.exe`, never committed and now lost), so the same data drew
 *     differently every run and the figures could not be regenerated. This layout is
 *     closed-form and O(n log n): identical input gives byte-identical output, which
 *     is what makes a figure in the paper reproducible from a manifest.
 *
 * Angular position carries meaning: each system owns a sector sized by how much of the
 * literature it accounts for, and a publication sits at the angle of the methods it
 * used. Radius carries level. Neither is decorative.
 */

export type CenterNodeKind = 'organism' | 'system' | 'aggregate' | 'publication'

export interface SystemInput {
  readonly name: string
  readonly type: 'physical' | 'genetic'
  /** Distinct publications using this system. Determines the sector's width. */
  readonly publicationCount: number
  /** Interaction records contributed. Determines the node's area. */
  readonly interactionCount: number
}

export interface PublicationInput {
  readonly key: string
  /** Display label, e.g. `Gavin AC (2002)`. */
  readonly label: string
  readonly year: number | null
  /** Every experimental system this publication used. Never empty. */
  readonly systems: readonly string[]
  /** Interactions contributed. Determines the node's area. */
  readonly interactionCount: number
}

export interface CenterLayoutInput {
  readonly organismLabel: string
  readonly systems: readonly SystemInput[]
  readonly publications: readonly PublicationInput[]
}

export interface CenterLayoutOptions {
  /**
   * Systems with fewer publications than this collapse into a single `Other methods`
   * node. This is the paper's third level: the long tail of rarely used assays would
   * otherwise consume half the circle in slivers too thin to read.
   */
  readonly aggregateBelow?: number
  /**
   * How to place a publication that used several methods. `circular-mean` puts it
   * once, between its methods, with an edge to each — one paper, one node.
   * `duplicate` places a copy in each method's sector, which reads more cleanly per
   * method but inflates the apparent size of the literature.
   */
  readonly multiMethod?: 'circular-mean' | 'duplicate'
  readonly systemRingRadius?: number
  readonly publicationRingRadius?: number
  /** Radial distance between successive publication rings. */
  readonly ringSpacing?: number
  readonly organismRadius?: number
  readonly systemNodeRadius?: [min: number, max: number]
  readonly publicationNodeRadius?: [min: number, max: number]
  /** Minimum angular share for any system, so a one-paper method stays clickable. */
  readonly minSectorFraction?: number
  /** Gap between adjacent sectors, in radians. */
  readonly sectorPadding?: number
  /** Angle, in radians, at which the first sector starts. */
  readonly startAngle?: number
}

const DEFAULTS = {
  aggregateBelow: 0,
  multiMethod: 'circular-mean',
  systemRingRadius: 260,
  publicationRingRadius: 520,
  ringSpacing: 52,
  organismRadius: 34,
  systemNodeRadius: [14, 34] as [number, number],
  publicationNodeRadius: [5, 16] as [number, number],
  minSectorFraction: 0.012,
  sectorPadding: 0.012,
  startAngle: -Math.PI / 2,
} satisfies Required<CenterLayoutOptions>

export interface LayoutNode {
  readonly id: string
  readonly kind: CenterNodeKind
  readonly label: string
  readonly x: number
  readonly y: number
  /** Drawn radius of the node itself. */
  readonly radius: number
  /** Angular position, radians. Meaningful: it identifies the method sector. */
  readonly angle: number
  /** Distance from the centre. */
  readonly distance: number
  /** Which concentric level: 0 organism, 1 system, 2+ publication rings. */
  readonly ring: number
  /** For system nodes, `physical` or `genetic`; for publications, the year. */
  readonly systemType?: 'physical' | 'genetic'
  readonly year?: number | null
  /** Systems this publication used, for tooltips and edge drawing. */
  readonly systems?: readonly string[]
  readonly interactionCount: number
  readonly publicationCount?: number
  /** For the aggregate node, the systems it stands for. */
  readonly aggregated?: readonly string[]
}

export interface LayoutEdge {
  readonly source: string
  readonly target: string
  readonly kind: 'organism-system' | 'system-publication'
}

export interface LayoutSector {
  readonly system: string
  readonly startAngle: number
  readonly endAngle: number
  readonly publicationCount: number
}

export interface CenterLayoutResult {
  readonly nodes: readonly LayoutNode[]
  readonly edges: readonly LayoutEdge[]
  readonly sectors: readonly LayoutSector[]
  /** Radius of the smallest circle containing every node, for framing the view. */
  readonly extent: number
}

/** The synthetic node standing in for the long tail of rare methods. */
export const AGGREGATE_SYSTEM_ID = '__other_methods__'
export const ORGANISM_ID = '__organism__'

const TWO_PI = Math.PI * 2

/**
 * Locale-independent string ordering.
 *
 * `String.prototype.localeCompare` depends on the host's locale and ICU data, so it
 * can order the same two method names differently on two machines. For a layout whose
 * value rests on being reproducible, that is not acceptable: sorting must be a
 * property of the data, not of where it was drawn.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Wrap an angle into [0, 2π). */
function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI
  return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

/** Node radius from a count, on a square-root scale so *area* tracks the count. */
function radiusFor(
  count: number,
  maxCount: number,
  [min, max]: [number, number],
): number {
  if (maxCount <= 0) return min
  const fraction = Math.sqrt(Math.max(0, count) / maxCount)
  return min + (max - min) * fraction
}

/**
 * Lay out the literature of one organism.
 *
 * Deterministic by construction: inputs are sorted canonically, nothing consults a
 * random source or a clock, and ties break on identifier. Two runs on the same data
 * produce identical coordinates.
 */
export function centerLayout(
  input: CenterLayoutInput,
  options: CenterLayoutOptions = {},
): CenterLayoutResult {
  const o = { ...DEFAULTS, ...options }

  const { systems, aggregated } = partitionSystems(input.systems, o.aggregateBelow)
  const sectors = allocateSectors(systems, aggregated, o)
  const sectorByName = new Map(sectors.map((s) => [s.system, s]))

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []

  // --- level 0: the organism ------------------------------------------------
  const totalInteractions = input.systems.reduce((sum, s) => sum + s.interactionCount, 0)
  nodes.push({
    id: ORGANISM_ID,
    kind: 'organism',
    label: input.organismLabel,
    x: 0,
    y: 0,
    radius: o.organismRadius,
    angle: 0,
    distance: 0,
    ring: 0,
    interactionCount: totalInteractions,
    publicationCount: input.publications.length,
  })

  // --- level 1: experimental systems ---------------------------------------
  const maxSystemInteractions = Math.max(
    1,
    ...sectors.map((s) => systemInteractionCount(s.system, systems, aggregated)),
  )

  for (const sector of sectors) {
    const mid = (sector.startAngle + sector.endAngle) / 2
    const isAggregate = sector.system === AGGREGATE_SYSTEM_ID
    const interactions = systemInteractionCount(sector.system, systems, aggregated)
    const id = systemNodeId(sector.system)

    nodes.push({
      id,
      kind: isAggregate ? 'aggregate' : 'system',
      label: isAggregate
        ? `Other methods (${aggregated.length})`
        : sector.system,
      x: Math.cos(mid) * o.systemRingRadius,
      y: Math.sin(mid) * o.systemRingRadius,
      radius: radiusFor(interactions, maxSystemInteractions, o.systemNodeRadius),
      angle: normalizeAngle(mid),
      distance: o.systemRingRadius,
      ring: 1,
      interactionCount: interactions,
      publicationCount: sector.publicationCount,
      ...(isAggregate
        ? { aggregated: aggregated.map((s) => s.name) }
        : { systemType: systemType(sector.system, systems, aggregated) }),
    })
    edges.push({ source: ORGANISM_ID, target: id, kind: 'organism-system' })
  }

  // --- level 2: publications ------------------------------------------------
  const placements = placePublications(input.publications, sectorByName, o)
  const maxPublicationInteractions = Math.max(
    1,
    ...input.publications.map((p) => p.interactionCount),
  )

  for (const placement of placements) {
    const { publication, angle, distance, ring, id, systemsShown } = placement
    nodes.push({
      id,
      kind: 'publication',
      label: publication.label,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      radius: radiusFor(
        publication.interactionCount,
        maxPublicationInteractions,
        o.publicationNodeRadius,
      ),
      angle: normalizeAngle(angle),
      distance,
      ring,
      year: publication.year,
      systems: publication.systems,
      interactionCount: publication.interactionCount,
    })
    for (const system of systemsShown) {
      edges.push({
        source: systemNodeId(system),
        target: id,
        kind: 'system-publication',
      })
    }
  }

  const extent = nodes.reduce((max, n) => Math.max(max, n.distance + n.radius), 0)
  return { nodes, edges, sectors, extent }
}

// --- system partitioning ----------------------------------------------------

interface Partitioned {
  readonly systems: readonly SystemInput[]
  readonly aggregated: readonly SystemInput[]
}

/** Split systems into those given their own sector and those folded into the tail. */
function partitionSystems(
  all: readonly SystemInput[],
  aggregateBelow: number,
): Partitioned {
  // Canonical order: most literature first, ties broken by name so the layout is
  // stable across runs and across releases that add a method.
  const sorted = [...all].sort(
    (a, b) => b.publicationCount - a.publicationCount || compareStrings(a.name, b.name),
  )
  if (aggregateBelow <= 0) return { systems: sorted, aggregated: [] }

  const kept = sorted.filter((s) => s.publicationCount >= aggregateBelow)
  const folded = sorted.filter((s) => s.publicationCount < aggregateBelow)
  // Folding a single system gains nothing and loses its name.
  return folded.length > 1 ? { systems: kept, aggregated: folded } : { systems: sorted, aggregated: [] }
}

function systemNodeId(name: string): string {
  return name === AGGREGATE_SYSTEM_ID ? AGGREGATE_SYSTEM_ID : `system:${name}`
}

function systemInteractionCount(
  name: string,
  systems: readonly SystemInput[],
  aggregated: readonly SystemInput[],
): number {
  if (name === AGGREGATE_SYSTEM_ID) {
    return aggregated.reduce((sum, s) => sum + s.interactionCount, 0)
  }
  return systems.find((s) => s.name === name)?.interactionCount ?? 0
}

function systemType(
  name: string,
  systems: readonly SystemInput[],
  aggregated: readonly SystemInput[],
): 'physical' | 'genetic' {
  return (
    systems.find((s) => s.name === name)?.type ??
    aggregated.find((s) => s.name === name)?.type ??
    'physical'
  )
}

// --- sector allocation ------------------------------------------------------

/**
 * Give each system an angular sector proportional to its share of the literature,
 * with a floor so a method used by one paper is still a visible target.
 */
function allocateSectors(
  systems: readonly SystemInput[],
  aggregated: readonly SystemInput[],
  o: Required<CenterLayoutOptions>,
): LayoutSector[] {
  const entries: { name: string; publicationCount: number }[] = systems.map((s) => ({
    name: s.name,
    publicationCount: s.publicationCount,
  }))
  if (aggregated.length > 0) {
    entries.push({
      name: AGGREGATE_SYSTEM_ID,
      publicationCount: aggregated.reduce((sum, s) => sum + s.publicationCount, 0),
    })
  }
  if (entries.length === 0) return []

  const total = entries.reduce((sum, e) => sum + e.publicationCount, 0)
  // Apply the floor, then renormalize so the shares still sum to one.
  const floored = entries.map((e) => ({
    ...e,
    share: Math.max(
      o.minSectorFraction,
      total > 0 ? e.publicationCount / total : 1 / entries.length,
    ),
  }))
  const flooredTotal = floored.reduce((sum, e) => sum + e.share, 0)

  const usable = TWO_PI - o.sectorPadding * entries.length
  const sectors: LayoutSector[] = []
  let cursor = o.startAngle

  for (const entry of floored) {
    const width = (entry.share / flooredTotal) * usable
    sectors.push({
      system: entry.name,
      startAngle: cursor,
      endAngle: cursor + width,
      publicationCount: entry.publicationCount,
    })
    cursor += width + o.sectorPadding
  }
  return sectors
}

// --- publication placement --------------------------------------------------

interface Placement {
  readonly publication: PublicationInput
  readonly id: string
  readonly angle: number
  readonly distance: number
  readonly ring: number
  /** Systems to draw an edge to. */
  readonly systemsShown: readonly string[]
}

/**
 * Place publications on the outer band.
 *
 * Each publication belongs to a method sector — the one method it used, or for a
 * multi-method paper the one nearest the circular mean of its methods — and is packed
 * into a fan filling that sector, inner rows first. The fan is what the published
 * figures show, and it is also the only arrangement that stays legible: giving every
 * publication of a method the sector's exact midpoint would stack them into a single
 * radial spike hundreds of rings long.
 *
 * A multi-method publication still gets an edge to *every* method it used. That is the
 * semantic fix over ProLiVis 1.0, and it is independent of where the node sits.
 */
function placePublications(
  publications: readonly PublicationInput[],
  sectors: ReadonlyMap<string, LayoutSector>,
  o: Required<CenterLayoutOptions>,
): Placement[] {
  interface Target {
    publication: PublicationInput
    id: string
    systemsShown: readonly string[]
    sector: LayoutSector
  }

  // Canonical order: the busiest publications take the inner, most legible rows,
  // then by key so the result never depends on input order.
  const ordered = [...publications].sort(
    (a, b) => b.interactionCount - a.interactionCount || compareStrings(a.key, b.key),
  )

  const bySector = new Map<string, Target[]>()
  const push = (target: Target) => {
    const list = bySector.get(target.sector.system)
    if (list) list.push(target)
    else bySector.set(target.sector.system, [target])
  }

  for (const publication of ordered) {
    const owned = publication.systems.filter((s) => sectors.has(s))
    // A publication whose every method was folded into the tail belongs to the tail.
    const effective = owned.length > 0 ? owned : [AGGREGATE_SYSTEM_ID]

    if (o.multiMethod === 'duplicate' && effective.length > 1) {
      for (const system of effective) {
        const sector = sectors.get(system)
        if (!sector) continue
        push({
          publication,
          id: `pub:${publication.key}@${system}`,
          systemsShown: [system],
          sector,
        })
      }
      continue
    }

    const home = nearestSector(circularMean(effective, sectors), effective, sectors)
    if (home) {
      push({
        publication,
        id: `pub:${publication.key}`,
        systemsShown: effective,
        sector: home,
      })
      continue
    }

    // No sector owns this publication — its methods are absent from the system list,
    // which a caller can produce by filtering systems but not publications. Place it
    // in the largest sector with no edges rather than dropping it: an unplaced
    // publication is silently missing literature, which is worse than an unattached
    // node the user can see and question.
    const fallback = [...sectors.values()][0]
    if (fallback) {
      push({
        publication,
        id: `pub:${publication.key}`,
        systemsShown: [],
        sector: fallback,
      })
    }
  }

  const placements: Placement[] = []
  const slotSize = 2.4 * o.publicationNodeRadius[1]

  // Sector order is deterministic; iterate it rather than the Map's insertion order.
  for (const sector of [...sectors.values()]) {
    const targets = bySector.get(sector.system)
    if (!targets || targets.length === 0) continue

    const width = sector.endAngle - sector.startAngle
    const arc = width * o.publicationRingRadius
    const columns = Math.max(1, Math.floor(arc / slotSize))

    targets.forEach((target, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const inThisRow = Math.min(columns, targets.length - row * columns)
      // Spread the row evenly across the sector, centring a partial last row.
      const t = (column + 0.5) / inThisRow
      placements.push({
        publication: target.publication,
        id: target.id,
        angle: sector.startAngle + t * width,
        distance: o.publicationRingRadius + row * o.ringSpacing,
        ring: row + 2,
        systemsShown: target.systemsShown,
      })
    })
  }

  return placements
}

/** The sector, among a publication's own methods, closest to a given direction. */
function nearestSector(
  angle: number,
  systems: readonly string[],
  sectors: ReadonlyMap<string, LayoutSector>,
): LayoutSector | null {
  let best: LayoutSector | null = null
  let bestDistance = Infinity

  for (const system of systems) {
    const sector = sectors.get(system)
    if (!sector) continue
    const mid = (sector.startAngle + sector.endAngle) / 2
    // Shortest angular separation, accounting for the wrap-around.
    const delta = Math.abs(((mid - angle + Math.PI + TWO_PI) % TWO_PI) - Math.PI)
    if (delta < bestDistance) {
      bestDistance = delta
      best = sector
    }
  }
  return best
}

/**
 * The mean direction of several sectors.
 *
 * Averaging angles arithmetically is wrong on a circle — the mean of 350° and 10° is
 * 0°, not 180° — so this averages unit vectors. When the directions cancel almost
 * exactly (methods on opposite sides of the circle), the mean is meaningless, and we
 * fall back to the widest sector rather than dropping the node at the centre.
 */
export function circularMean(
  systems: readonly string[],
  sectors: ReadonlyMap<string, LayoutSector>,
): number {
  let x = 0
  let y = 0
  let widest: LayoutSector | null = null

  for (const system of systems) {
    const sector = sectors.get(system)
    if (!sector) continue
    const mid = (sector.startAngle + sector.endAngle) / 2
    x += Math.cos(mid)
    y += Math.sin(mid)
    if (!widest || sector.endAngle - sector.startAngle > widest.endAngle - widest.startAngle) {
      widest = sector
    }
  }

  if (Math.hypot(x, y) < 1e-9) {
    return widest ? (widest.startAngle + widest.endAngle) / 2 : 0
  }
  return Math.atan2(y, x)
}
