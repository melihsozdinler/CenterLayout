/**
 * Comparing and merging datasets.
 *
 * The questions this answers are the ones a BioGRID user actually has and cannot
 * currently ask: what changed between releases, what does my organism share with
 * another, and what does the union of two queries look like without double-counting.
 *
 * Every result keeps per-edge provenance — which datasets asserted this interaction,
 * and with what evidence in each. A merged network that cannot say where an edge came
 * from is worse than no merge at all: it launders a single-source claim into an
 * apparently corroborated one.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { buildGenesInsert, buildPublicationsInsert, sqlString } from '../model/schema'
import { organismFilter } from '../model/datasets'

export type SetOperation = 'union' | 'intersection' | 'difference' | 'symmetric-difference'

export interface ComparisonSide {
  readonly datasetId: string
  /** Restrict this side to one organism. */
  readonly organismId?: number
  /** Display name; defaults to the dataset label. */
  readonly label?: string
}

export interface CompareQuery {
  readonly left: ComparisonSide
  readonly right: ComparisonSide
  /**
   * Compare by gene symbol rather than by BioGRID gene id.
   *
   * Necessary when comparing across organisms, where the same protein has different
   * gene ids — but unsafe within a cross-species dataset, where distinct organisms
   * reuse symbols. Off by default for that reason.
   */
  readonly bySymbol?: boolean
  readonly limit?: number
}

export type EdgePresence = 'both' | 'left-only' | 'right-only'

export interface ComparedEdge {
  readonly key: string
  readonly symbolA: string | null
  readonly symbolB: string | null
  readonly presence: EdgePresence
  readonly leftPublications: number
  readonly rightPublications: number
  readonly leftSystems: number
  readonly rightSystems: number
  /** Publications supporting it in one side but not the other. */
  readonly newPublications: number
}

export interface ComparisonSummary {
  readonly leftLabel: string
  readonly rightLabel: string
  readonly leftOnly: number
  readonly rightOnly: number
  readonly shared: number
  /** Shared / union — how much the two datasets agree. */
  readonly jaccard: number
  /** Interactions in both, where one side has evidence the other lacks. */
  readonly sharedWithNewEvidence: number
  readonly comparedBy: 'gene-id' | 'symbol'
}

export interface ComparisonResult {
  readonly summary: ComparisonSummary
  readonly edges: readonly ComparedEdge[]
}

/** SQL selecting one side's interactions, keyed for comparison. */
function sideQuery(side: ComparisonSide, bySymbol: boolean): string {
  const where = organismFilter(side.datasetId, side.organismId)

  // Keying by symbol needs a canonical order, since the pair key's node order comes
  // from gene ids that differ between datasets.
  const key = bySymbol
    ? `least(upper(symbol_lo_x), upper(symbol_hi_x)) || '|' ||
       greatest(upper(symbol_lo_x), upper(symbol_hi_x))`
    : `pair_key`

  return `
    SELECT
      ${key}                              AS key,
      any_value(symbol_lo_x)              AS symbol_a,
      any_value(symbol_hi_x)              AS symbol_b,
      count(DISTINCT publication_key)     AS publications,
      count(DISTINCT experimental_system) AS systems,
      list(DISTINCT publication_key)      AS publication_list
    FROM (
      SELECT
        pair_key,
        publication_key,
        experimental_system,
        CASE WHEN biogrid_id_a = node_lo THEN symbol_a ELSE symbol_b END AS symbol_lo_x,
        CASE WHEN biogrid_id_a = node_hi THEN symbol_a ELSE symbol_b END AS symbol_hi_x
      FROM interactions
      WHERE ${where} AND pair_key IS NOT NULL
    )
    ${bySymbol ? 'WHERE symbol_lo_x IS NOT NULL AND symbol_hi_x IS NOT NULL' : ''}
    GROUP BY 1`
}

interface CompareRow {
  key: string
  symbol_a: string | null
  symbol_b: string | null
  left_publications: bigint | number | null
  right_publications: bigint | number | null
  left_systems: bigint | number | null
  right_systems: bigint | number | null
  new_publications: bigint | number | null
}

const num = (v: bigint | number | null | undefined): number => Number(v ?? 0)

/** Compare two datasets edge by edge. */
export async function compareDatasets(
  engine: DuckDBEngine,
  query: CompareQuery,
): Promise<ComparisonResult> {
  const bySymbol = query.bySymbol ?? false
  const limit = query.limit === undefined ? '' : `LIMIT ${Math.floor(query.limit)}`

  const rows = await engine.rows<CompareRow>(`
    WITH l AS (${sideQuery(query.left, bySymbol)}),
         r AS (${sideQuery(query.right, bySymbol)})
    SELECT
      coalesce(l.key, r.key)                    AS key,
      coalesce(l.symbol_a, r.symbol_a)          AS symbol_a,
      coalesce(l.symbol_b, r.symbol_b)          AS symbol_b,
      l.publications                            AS left_publications,
      r.publications                            AS right_publications,
      l.systems                                 AS left_systems,
      r.systems                                 AS right_systems,
      -- Publications supporting this interaction on the right that the left lacks.
      CASE
        WHEN l.key IS NULL OR r.key IS NULL THEN 0
        ELSE len(list_filter(r.publication_list, x -> NOT list_contains(l.publication_list, x)))
      END                                       AS new_publications
    FROM l FULL OUTER JOIN r ON l.key = r.key
    ORDER BY
      coalesce(l.publications, 0) + coalesce(r.publications, 0) DESC,
      coalesce(l.key, r.key)
    ${limit}`)

  const edges: ComparedEdge[] = rows.map((row) => {
    const left = row.left_publications !== null
    const right = row.right_publications !== null
    return {
      key: row.key,
      symbolA: row.symbol_a,
      symbolB: row.symbol_b,
      presence: left && right ? 'both' : left ? 'left-only' : 'right-only',
      leftPublications: num(row.left_publications),
      rightPublications: num(row.right_publications),
      leftSystems: num(row.left_systems),
      rightSystems: num(row.right_systems),
      newPublications: num(row.new_publications),
    }
  })

  const leftOnly = edges.filter((e) => e.presence === 'left-only').length
  const rightOnly = edges.filter((e) => e.presence === 'right-only').length
  const shared = edges.filter((e) => e.presence === 'both').length
  const union = leftOnly + rightOnly + shared

  return {
    summary: {
      leftLabel: query.left.label ?? query.left.datasetId,
      rightLabel: query.right.label ?? query.right.datasetId,
      leftOnly,
      rightOnly,
      shared,
      jaccard: union === 0 ? 0 : shared / union,
      sharedWithNewEvidence: edges.filter(
        (e) => e.presence === 'both' && e.newPublications > 0,
      ).length,
      comparedBy: bySymbol ? 'symbol' : 'gene-id',
    },
    edges,
  }
}

/** Apply a set operation to a comparison, returning the surviving edges. */
export function applySetOperation(
  result: ComparisonResult,
  operation: SetOperation,
): ComparedEdge[] {
  switch (operation) {
    case 'union':
      return [...result.edges]
    case 'intersection':
      return result.edges.filter((e) => e.presence === 'both')
    case 'difference':
      return result.edges.filter((e) => e.presence === 'left-only')
    case 'symmetric-difference':
      return result.edges.filter((e) => e.presence !== 'both')
  }
}

export interface MergeResult {
  readonly datasetId: string
  readonly label: string
  readonly recordCount: number
  readonly sourceDatasets: readonly string[]
}

/**
 * Merge several datasets into a new one.
 *
 * Records are copied rather than re-derived, and duplicates — the same BioGRID
 * interaction id appearing in two releases — are collapsed. Without that, merging a
 * release with its successor would double every unchanged interaction and inflate
 * every replication count in the trust model.
 */
export async function mergeDatasets(
  engine: DuckDBEngine,
  sources: readonly ComparisonSide[],
  options: { label?: string } = {},
): Promise<MergeResult> {
  if (sources.length < 2) {
    throw new Error('Merging needs at least two datasets')
  }

  const datasetId = `merge_${Math.random().toString(36).slice(2, 10)}`
  const label = options.label ?? `Merged (${sources.length} datasets)`

  const sourceLabels = await engine.rows<{ dataset_id: string; label: string }>(`
    SELECT dataset_id, label FROM datasets
    WHERE dataset_id IN (${sources.map((s) => sqlString(s.datasetId)).join(', ')})`)
  const detail = sourceLabels.map((s) => s.label).join(' + ')

  await engine.exec(`
    INSERT INTO datasets (dataset_id, label, source_kind, source_detail, biogrid_release,
                          loaded_at, record_count, notes)
    VALUES (${sqlString(datasetId)}, ${sqlString(label)}, 'file',
            ${sqlString(`merge of ${detail}`)}, NULL, now(), 0,
            ${sqlString(`Merged from: ${sourceLabels.map((s) => s.dataset_id).join(', ')}`)})`)

  const selects = sources.map(
    (side) => `
      SELECT * REPLACE (${sqlString(datasetId)} AS dataset_id)
      FROM interactions
      WHERE ${organismFilter(side.datasetId, side.organismId)}`,
  )

  // DISTINCT ON the BioGRID interaction id: the same record present in two releases is
  // one assertion, not two, and counting it twice would inflate replication.
  const inserted = await engine.execCount(`
    INSERT INTO interactions
    SELECT * FROM (
      SELECT DISTINCT ON (biogrid_interaction_id, experimental_system, publication_key) *
      FROM (${selects.join(' UNION ALL ')})
    )`)

  await engine.exec(buildGenesInsert(datasetId))
  await engine.exec(buildPublicationsInsert(datasetId))
  await engine.exec(
    `UPDATE datasets SET record_count = ${inserted} WHERE dataset_id = ${sqlString(datasetId)}`,
  )
  await engine.createIndexes()
  await engine.checkpoint()

  return {
    datasetId,
    label,
    recordCount: inserted,
    sourceDatasets: sources.map((s) => s.datasetId),
  }
}
