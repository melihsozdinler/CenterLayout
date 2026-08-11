/**
 * Building the center layout's input from a loaded dataset.
 *
 * The one query that matters is the publication-to-system mapping. ProLiVis 1.0 asked
 * for it with `SELECT DISTINCT(SOURCE), EXPERIMENTSYSTEM ... GROUP BY SOURCE`, which
 * makes SQLite pick an arbitrary system per publication — a paper reporting three
 * assays was filed under one of them, chosen by whatever the query planner did first.
 * Here the mapping is many-to-many, as the data always was.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { organismFilter } from '../model/datasets'
import { sqlString } from '../model/schema'
import { lookupExperimentalSystem } from '../data/vocabulary'
import type { CenterLayoutInput, PublicationInput, SystemInput } from './center-layout'

export interface CenterGraphQuery {
  readonly datasetId: string
  /** Restrict to one organism. Omit for the whole dataset. */
  readonly organismId?: number
  /** Only these experimental systems. */
  readonly systems?: readonly string[]
  /** Drop publications contributing fewer interactions than this. */
  readonly minInteractions?: number
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
  systems: string | null
}

const SEP = String.fromCharCode(0x1f)

/** Assemble the layout input for one organism's literature. */
export async function buildCenterGraph(
  engine: DuckDBEngine,
  query: CenterGraphQuery,
): Promise<CenterLayoutInput> {
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

  const systemRows = await engine.rows<SystemRow>(`
    SELECT
      experimental_system,
      any_value(experimental_system_type) AS experimental_system_type,
      count(DISTINCT publication_key)     AS publication_count,
      count(DISTINCT pair_key)            AS interaction_count
    FROM interactions
    WHERE ${where}
    GROUP BY experimental_system`)

  const having =
    query.minInteractions === undefined
      ? ''
      : `HAVING count(DISTINCT i.pair_key) >= ${Math.floor(query.minInteractions)}`

  const publicationRows = await engine.rows<PublicationRow>(`
    SELECT
      i.publication_key,
      any_value(p.author_label)                                   AS author_label,
      max(i.publication_year)                                     AS year,
      count(DISTINCT i.pair_key)                                  AS interaction_count,
      string_agg(DISTINCT i.experimental_system, ${sqlString(SEP)}) AS systems
    FROM interactions i
    LEFT JOIN publications p
      ON p.dataset_id = i.dataset_id AND p.publication_key = i.publication_key
    WHERE ${whereFor('i')}
      AND i.publication_key IS NOT NULL
    GROUP BY i.publication_key
    ${having}`)

  const systems: SystemInput[] = systemRows.map((row) => ({
    name: row.experimental_system,
    type:
      (row.experimental_system_type ??
        lookupExperimentalSystem(row.experimental_system).type) === 'genetic'
        ? 'genetic'
        : 'physical',
    publicationCount: Number(row.publication_count),
    interactionCount: Number(row.interaction_count),
  }))

  const publications: PublicationInput[] = publicationRows.map((row) => ({
    key: row.publication_key,
    // Fall back to the raw key: a publication with no author label is still a node,
    // and hiding it would understate the literature.
    label: row.author_label ?? row.publication_key,
    year: row.year === null ? null : Number(row.year),
    systems: row.systems ? row.systems.split(SEP).filter(Boolean) : [],
    interactionCount: Number(row.interaction_count),
  }))

  const organismLabel =
    query.organismLabel ?? (await defaultLabel(engine, query))

  return { organismLabel, systems, publications }
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
