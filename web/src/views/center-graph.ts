/**
 * Building the center layout's input from a loaded dataset.
 *
 * The one query that matters is the publication-to-system mapping. ProLiVis 1.0 asked
 * for it with `SELECT DISTINCT(SOURCE), EXPERIMENTSYSTEM ... GROUP BY SOURCE`, which
 * makes SQLite pick an arbitrary system per publication — a paper reporting three
 * assays was filed under one of them, chosen by whatever the query planner did first.
 * Here the mapping is many-to-many, as the data always was.
 *
 * The literature can also be filtered before it is drawn: by how many interactions a
 * publication contributed, by how many proteins it touched, and by which methods it
 * used. A screen reporting ten thousand interactions and a structure paper reporting
 * one are both single nodes in this layout, and being able to ask for one kind or the
 * other is the difference between a picture of the field and a picture of its largest
 * screens.
 *
 * When publications are filtered the method ring is recomputed from the survivors,
 * not from the whole dataset. A sector's width is its share of the literature, and a
 * sector sized by papers that are no longer drawn would be a lie about the picture.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { organismFilter } from '../model/datasets'
import { sqlString } from '../model/schema'
import { lookupExperimentalSystem } from '../data/vocabulary'
import type {
  CenterFilterSummary,
  CenterLayoutInput,
  PublicationInput,
  SystemInput,
} from './center-layout'

export interface CenterGraphQuery {
  readonly datasetId: string
  /** Restrict to one organism. Omit for the whole dataset. */
  readonly organismId?: number
  /** Only these experimental systems. Omit or leave empty for all of them. */
  readonly systems?: readonly string[]
  /** Drop publications contributing fewer interactions than this. */
  readonly minInteractions?: number
  /** Drop publications contributing more interactions than this. */
  readonly maxInteractions?: number
  /** Drop publications touching fewer distinct proteins than this. */
  readonly minProteins?: number
  /** Drop publications touching more distinct proteins than this. */
  readonly maxProteins?: number
  /** Label for the centre node; defaults to the organism or dataset name. */
  readonly organismLabel?: string
}

interface SystemRow {
  experimental_system: string
  experimental_system_type: string | null
  publication_count: bigint | number
  interaction_count: bigint | number
}

interface PublicationRow {
  publication_key: string
  author_label: string | null
  year: number | null
  interaction_count: bigint | number
  protein_count: bigint | number
  systems: string | null
}

const SEP = String.fromCharCode(0x1f)

/** The input, plus what the filters did to it. */
export interface CenterGraphResult extends CenterLayoutInput {
  readonly filter: CenterFilterSummary
}

/** Assemble the layout input for one organism's literature. */
export async function buildCenterGraph(
  engine: DuckDBEngine,
  query: CenterGraphQuery,
): Promise<CenterGraphResult> {
  const systemList = query.systems?.length
    ? query.systems.map(sqlString).join(', ')
    : null

  const whereFor = (alias?: string) => {
    const q = alias ? `${alias}.` : ''
    const parts = [
      organismFilter(query.datasetId, query.organismId, alias),
      `${q}experimental_system IS NOT NULL`,
    ]
    if (systemList) parts.push(`${q}experimental_system IN (${systemList})`)
    return parts.join(' AND ')
  }
  const where = whereFor()

  /**
   * One aggregate per publication.
   *
   * `unnest` doubles each record into its two interactors so that proteins can be
   * counted distinctly across both sides in the same pass — counting the two columns
   * separately would double every protein that appears as bait in one record and prey
   * in another, which in an affinity-capture screen is most of them.
   */
  const perPublication = `
    SELECT
      publication_key,
      count(DISTINCT pair_key)                                  AS interaction_count,
      count(DISTINCT gene)                                      AS protein_count,
      max(publication_year)                                     AS year,
      string_agg(DISTINCT experimental_system, ${sqlString(SEP)}) AS systems
    FROM (
      SELECT
        publication_key,
        pair_key,
        publication_year,
        experimental_system,
        unnest([biogrid_id_a, biogrid_id_b]) AS gene
      FROM interactions
      WHERE ${where} AND publication_key IS NOT NULL
    )
    GROUP BY publication_key`

  const publicationRows = await engine.rows<PublicationRow>(`
    SELECT
      agg.publication_key,
      any_value(p.author_label) AS author_label,
      any_value(agg.year)       AS year,
      any_value(agg.interaction_count) AS interaction_count,
      any_value(agg.protein_count)     AS protein_count,
      any_value(agg.systems)           AS systems
    FROM (${perPublication}) agg
    LEFT JOIN publications p
      ON p.dataset_id = ${sqlString(query.datasetId)}
     AND p.publication_key = agg.publication_key
    GROUP BY agg.publication_key`)

  // Filtering happens here rather than in SQL so that the bounds the interface offers
  // are the bounds of the data the user is looking at, not of whatever survived the
  // last filter — a slider whose maximum moves when you drag it is unusable.
  const all: PublicationInput[] = publicationRows.map((row) => ({
    key: row.publication_key,
    // Fall back to the raw key: a publication with no author label is still a node,
    // and hiding it would understate the literature.
    label: row.author_label ?? row.publication_key,
    year: row.year === null ? null : Number(row.year),
    systems: row.systems ? row.systems.split(SEP).filter(Boolean) : [],
    interactionCount: Number(row.interaction_count),
    proteinCount: Number(row.protein_count),
  }))

  const bounds = keepBounds(query)
  const publications = all.filter(
    (publication) =>
      publication.interactionCount >= bounds.minInteractions &&
      publication.interactionCount <= bounds.maxInteractions &&
      publication.proteinCount >= bounds.minProteins &&
      publication.proteinCount <= bounds.maxProteins,
  )

  const filter: CenterFilterSummary = {
    publicationsBefore: all.length,
    publicationsAfter: publications.length,
    interactionRange: range(all.map((p) => p.interactionCount)),
    proteinRange: range(all.map((p) => p.proteinCount)),
    systems: query.systems?.length ? [...query.systems] : null,
  }

  const systems = await systemRing(engine, where, perPublication, bounds, filter)
  const organismLabel = query.organismLabel ?? (await defaultLabel(engine, query))

  return { organismLabel, systems, publications, filter }
}

interface Bounds {
  minInteractions: number
  maxInteractions: number
  minProteins: number
  maxProteins: number
}

function keepBounds(query: CenterGraphQuery): Bounds {
  return {
    minInteractions: query.minInteractions ?? 0,
    maxInteractions: query.maxInteractions ?? Infinity,
    minProteins: query.minProteins ?? 0,
    maxProteins: query.maxProteins ?? Infinity,
  }
}

function range(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 0]
  return [Math.min(...values), Math.max(...values)]
}

/**
 * The method ring, over the publications that survived the filter.
 *
 * Recomputed in the database rather than summed from the publication rows: a sector's
 * area is distinct *interactions* using that method, and adding up the publications
 * that used it would count an interaction once per paper reporting it.
 */
async function systemRing(
  engine: DuckDBEngine,
  where: string,
  perPublication: string,
  bounds: Bounds,
  filter: CenterFilterSummary,
): Promise<SystemInput[]> {
  const filtered = filter.publicationsAfter !== filter.publicationsBefore
  const having: string[] = []
  if (bounds.minInteractions > 0) having.push(`interaction_count >= ${bounds.minInteractions}`)
  if (Number.isFinite(bounds.maxInteractions)) having.push(`interaction_count <= ${bounds.maxInteractions}`)
  if (bounds.minProteins > 0) having.push(`protein_count >= ${bounds.minProteins}`)
  if (Number.isFinite(bounds.maxProteins)) having.push(`protein_count <= ${bounds.maxProteins}`)

  const restriction =
    filtered && having.length > 0
      ? ` AND publication_key IN (
            SELECT publication_key FROM (${perPublication})
             WHERE ${having.join(' AND ')})`
      : ''

  const rows = await engine.rows<SystemRow>(`
    SELECT
      experimental_system,
      any_value(experimental_system_type) AS experimental_system_type,
      count(DISTINCT publication_key)     AS publication_count,
      count(DISTINCT pair_key)            AS interaction_count
    FROM interactions
    WHERE ${where}${restriction}
    GROUP BY experimental_system`)

  return rows.map((row) => ({
    name: row.experimental_system,
    type:
      (row.experimental_system_type ??
        lookupExperimentalSystem(row.experimental_system).type) === 'genetic'
        ? 'genetic'
        : 'physical',
    publicationCount: Number(row.publication_count),
    interactionCount: Number(row.interaction_count),
  }))
}

async function defaultLabel(
  engine: DuckDBEngine,
  query: CenterGraphQuery,
): Promise<string> {
  if (query.organismId !== undefined) {
    const name = await engine.scalar<string>(`
      SELECT any_value(organism_name) FROM genes
      WHERE dataset_id = ${sqlString(query.datasetId)}
        AND organism_id = ${query.organismId}`)
    if (name) return name
    return `taxid ${query.organismId}`
  }
  const label = await engine.scalar<string>(
    `SELECT label FROM datasets WHERE dataset_id = ${sqlString(query.datasetId)}`,
  )
  return label ?? 'Dataset'
}
