/**
 * Inputs for the views the interface does not draw.
 *
 * `upset`, `timeline`, `methodChord` and `bipartite` take assembled inputs rather than
 * a query, which kept them independent of the database — and left them unreachable:
 * nothing produced those inputs, so a documented capability could not actually be used
 * without writing the SQL by hand. These are the missing halves.
 *
 * The same `EvidenceQuery` and the same where-clause as the trust model, so a view and
 * a score computed over "SARS-CoV-2, physical only" are computed over the same rows.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { whereClause, type EvidenceQuery } from '../trust/score'
import type { PairSystems } from '../views/matrix'
import type { TimelineRecord } from '../views/timeline'
import type { BipartiteInput } from '../views/bipartite'

const SEP = String.fromCharCode(0x1f)

/**
 * `physicalOnly` is a property of the interaction, not of the record: a pair qualifies
 * if *any* of its records is physical, which the trust model applies as a HAVING over
 * the per-pair aggregate. These queries group differently — per publication, per
 * method — so they restrict to the qualifying pairs instead. Same rows either way,
 * which is the point: a view and a score of the same query must describe the same
 * interactions.
 */
function physicalRestriction(query: EvidenceQuery, alias = 'i'): string {
  if (!query.physicalOnly) return ''
  return ` AND ${alias}.pair_key IN (
      SELECT p.pair_key FROM interactions p
       WHERE ${whereClause(query, 'p')}
       GROUP BY p.pair_key
      HAVING bool_or(p.experimental_system_type = 'physical'))`
}

/** Which experimental systems support each interaction. Feeds `upset` and `methodChord`. */
export async function pairSystems(
  engine: DuckDBEngine,
  query: EvidenceQuery,
): Promise<PairSystems[]> {
  const rows = await engine.rows<{ pair_key: string; systems: string | null }>(`
    SELECT i.pair_key,
           string_agg(DISTINCT i.experimental_system, ${sqlLiteral(SEP)}) AS systems
      FROM interactions i
     WHERE ${whereClause(query)} AND i.experimental_system IS NOT NULL${physicalRestriction(query)}
     GROUP BY i.pair_key`)

  return rows.map((row) => ({
    pairKey: row.pair_key,
    systems: row.systems ? row.systems.split(SEP).filter(Boolean) : [],
  }))
}

/**
 * One row per (interaction, publication, method), which is what a timeline needs: the
 * same interaction reported in 2004 and again in 2019 is two points, and collapsing it
 * to one would hide exactly the replication the view exists to show.
 */
export async function timelineRecords(
  engine: DuckDBEngine,
  query: EvidenceQuery,
): Promise<TimelineRecord[]> {
  const rows = await engine.rows<{
    pair_key: string
    label: string | null
    year: number | null
    publication_key: string | null
    experimental_system: string
    low: boolean
    high: boolean
  }>(`
    SELECT
      i.pair_key,
      any_value(coalesce(i.symbol_a, '') || ' – ' || coalesce(i.symbol_b, '')) AS label,
      max(i.publication_year)          AS year,
      i.publication_key,
      i.experimental_system,
      bool_or(i.throughput_low)        AS low,
      bool_or(i.throughput_high)       AS high
    FROM interactions i
    WHERE ${whereClause(query)}
      AND i.experimental_system IS NOT NULL${physicalRestriction(query)}
    GROUP BY i.pair_key, i.publication_key, i.experimental_system`)

  return rows.map((row) => ({
    pairKey: row.pair_key,
    label: (row.label ?? '').trim() || row.pair_key,
    year: row.year === null ? null : Number(row.year),
    publicationKey: row.publication_key ?? '',
    system: row.experimental_system,
    lowThroughput: Boolean(row.low),
    highThroughput: Boolean(row.high),
  }))
}

export interface BipartiteQueryOptions {
  /** Keep the busiest publications and the proteins they touch. */
  readonly maxPublications?: number
}

/**
 * Publications, proteins, and which touched which.
 *
 * Bounded by publication count rather than by protein count: the view's lanes are
 * publications, and a bipartite drawing of ten thousand of them says nothing. The
 * proteins are then whatever those publications reported.
 */
export async function bipartiteInput(
  engine: DuckDBEngine,
  query: EvidenceQuery,
  options: BipartiteQueryOptions = {},
): Promise<BipartiteInput> {
  const limit = Math.max(1, Math.floor(options.maxPublications ?? 40))
  const where = whereClause(query) + physicalRestriction(query)

  const publications = await engine.rows<{
    publication_key: string
    label: string | null
    year: number | null
    system: string
    interaction_count: bigint | number
  }>(`
    SELECT
      i.publication_key,
      any_value(p.author_label)                     AS label,
      max(i.publication_year)                       AS year,
      mode(i.experimental_system)                   AS system,
      count(DISTINCT i.pair_key)                    AS interaction_count
    FROM interactions i
    LEFT JOIN publications p
      ON p.dataset_id = i.dataset_id AND p.publication_key = i.publication_key
    WHERE ${where} AND i.publication_key IS NOT NULL
      AND i.experimental_system IS NOT NULL
    GROUP BY i.publication_key
    ORDER BY interaction_count DESC, i.publication_key
    LIMIT ${limit}`)

  if (publications.length === 0) return { publications: [], proteins: [], links: [] }

  const keys = publications.map((row) => sqlLiteral(row.publication_key)).join(', ')
  const links = await engine.rows<{
    publication_key: string
    gene: bigint | number
    symbol: string | null
    weight: bigint | number
  }>(`
    SELECT publication_key, gene, any_value(symbol) AS symbol, count(*) AS weight
      FROM (
        SELECT i.publication_key,
               unnest([i.biogrid_id_a, i.biogrid_id_b]) AS gene,
               unnest([i.symbol_a, i.symbol_b])         AS symbol
          FROM interactions i
         WHERE ${where} AND i.publication_key IN (${keys})
      )
     WHERE gene IS NOT NULL
     GROUP BY publication_key, gene`)

  const proteins = new Map<number, { id: number; label: string; publicationCount: number }>()
  for (const link of links) {
    const id = Number(link.gene)
    const existing = proteins.get(id)
    if (existing) existing.publicationCount += 1
    else proteins.set(id, { id, label: link.symbol ?? String(id), publicationCount: 1 })
  }

  return {
    publications: publications.map((row) => ({
      key: row.publication_key,
      label: row.label ?? row.publication_key,
      year: row.year === null ? null : Number(row.year),
      system: row.system,
      interactionCount: Number(row.interaction_count),
    })),
    proteins: [...proteins.values()].sort(
      (a, b) => b.publicationCount - a.publicationCount || a.id - b.id,
    ),
    links: links.map((link) => ({
      publicationKey: link.publication_key,
      proteinId: Number(link.gene),
      weight: Number(link.weight),
    })),
  }
}

/** Single-quoted SQL literal. Duplicated from the schema module to avoid a cycle. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
