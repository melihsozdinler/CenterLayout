/**
 * Bipartite publication ↔ protein view, with method lanes.
 *
 * The center layout shows which methods a literature uses; this shows which proteins
 * each publication actually touched. Publications on one axis, proteins on the other,
 * grouped into horizontal lanes by experimental method — so a screen that reported
 * four hundred interactions and a structure paper that reported one are visibly
 * different objects rather than two equal dots.
 */

export interface BipartiteInput {
  readonly publications: readonly {
    readonly key: string
    readonly label: string
    readonly year: number | null
    /** Primary experimental system, used to choose the lane. */
    readonly system: string
    readonly interactionCount: number
  }[]
  readonly proteins: readonly {
    readonly id: number
    readonly label: string
    /** Publications reporting this protein. */
    readonly publicationCount: number
  }[]
  readonly links: readonly {
    readonly publicationKey: string
    readonly proteinId: number
    readonly weight: number
  }[]
}

export interface BipartiteOptions {
  readonly width?: number
  readonly laneHeight?: number
  readonly laneGap?: number
  readonly proteinColumnWidth?: number
  /** Cap the proteins shown, busiest first. */
  readonly maxProteins?: number
  /** Cap the publications shown, busiest first. */
  readonly maxPublications?: number
}

export interface BipartiteNode {
  readonly id: string
  readonly kind: 'publication' | 'protein'
  readonly label: string
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly lane: string | null
  readonly year?: number | null
  readonly count: number
}

export interface BipartiteLink {
  readonly source: string
  readonly target: string
  readonly weight: number
}

export interface BipartiteLane {
  readonly system: string
  readonly y: number
  readonly height: number
  readonly publicationCount: number
}

export interface BipartiteView {
  readonly nodes: readonly BipartiteNode[]
  readonly links: readonly BipartiteLink[]
  readonly lanes: readonly BipartiteLane[]
  readonly bounds: readonly [number, number, number, number]
  readonly truncated: boolean
}

const DEFAULTS = {
  width: 1400,
  laneHeight: 130,
  laneGap: 26,
  proteinColumnWidth: 260,
  maxProteins: 200,
  maxPublications: 300,
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function buildBipartite(
  input: BipartiteInput,
  options: BipartiteOptions = {},
): BipartiteView {
  const o = { ...DEFAULTS, ...options }

  // Busiest first, so a cap keeps what matters rather than an arbitrary slice.
  const publications = [...input.publications]
    .sort((a, b) => b.interactionCount - a.interactionCount || compare(a.key, b.key))
    .slice(0, o.maxPublications)
  const proteins = [...input.proteins]
    .sort((a, b) => b.publicationCount - a.publicationCount || a.id - b.id)
    .slice(0, o.maxProteins)

  const truncated =
    publications.length < input.publications.length ||
    proteins.length < input.proteins.length

  const keptPublications = new Set(publications.map((p) => p.key))
  const keptProteins = new Set(proteins.map((p) => p.id))

  // Lanes ordered by how much literature each method carries.
  const laneCounts = new Map<string, number>()
  for (const publication of publications) {
    laneCounts.set(publication.system, (laneCounts.get(publication.system) ?? 0) + 1)
  }
  const laneOrder = [...laneCounts.entries()]
    .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
    .map(([system]) => system)

  const lanes: BipartiteLane[] = []
  const laneY = new Map<string, number>()
  let cursor = 0
  for (const system of laneOrder) {
    lanes.push({
      system,
      y: cursor,
      height: o.laneHeight,
      publicationCount: laneCounts.get(system) ?? 0,
    })
    laneY.set(system, cursor)
    cursor += o.laneHeight + o.laneGap
  }
  const totalHeight = Math.max(cursor - o.laneGap, o.laneHeight)

  const maxPublicationCount = Math.max(1, ...publications.map((p) => p.interactionCount))
  const maxProteinCount = Math.max(1, ...proteins.map((p) => p.publicationCount))

  const nodes: BipartiteNode[] = []
  const publicationX = o.proteinColumnWidth + 120

  // Publications: laid out left to right within their lane, oldest first, so the lane
  // also reads as a timeline.
  const byLane = new Map<string, typeof publications>()
  for (const publication of publications) {
    const list = byLane.get(publication.system)
    if (list) list.push(publication)
    else byLane.set(publication.system, [publication])
  }

  for (const [system, list] of byLane) {
    const y = laneY.get(system) ?? 0
    const ordered = [...list].sort(
      (a, b) => (a.year ?? 0) - (b.year ?? 0) || compare(a.key, b.key),
    )
    const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 3)))
    const usableWidth = o.width - publicationX

    ordered.forEach((publication, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const rows = Math.ceil(ordered.length / columns)
      nodes.push({
        id: `pub:${publication.key}`,
        kind: 'publication',
        label: publication.label,
        x: publicationX + ((column + 0.5) / columns) * usableWidth,
        y: y + ((row + 0.5) / Math.max(1, rows)) * o.laneHeight,
        radius:
          4 + 10 * Math.sqrt(publication.interactionCount / maxPublicationCount),
        lane: system,
        year: publication.year,
        count: publication.interactionCount,
      })
    })
  }

  // Proteins: one column on the left, most-reported at the top.
  proteins.forEach((protein, index) => {
    nodes.push({
      id: `gene:${protein.id}`,
      kind: 'protein',
      label: protein.label,
      x: 0,
      y: ((index + 0.5) / proteins.length) * totalHeight,
      radius: 3 + 7 * Math.sqrt(protein.publicationCount / maxProteinCount),
      lane: null,
      count: protein.publicationCount,
    })
  })

  const links: BipartiteLink[] = input.links
    .filter(
      (link) =>
        keptPublications.has(link.publicationKey) && keptProteins.has(link.proteinId),
    )
    .map((link) => ({
      source: `pub:${link.publicationKey}`,
      target: `gene:${link.proteinId}`,
      weight: link.weight,
    }))

  return {
    nodes,
    links,
    lanes,
    bounds: [-140, -40, o.width + 40, totalHeight + 40],
    truncated,
  }
}
