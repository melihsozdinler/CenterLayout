/**
 * Applying the trust model to a loaded dataset.
 *
 * Scoring runs in TypeScript rather than SQL on purpose. The weights are meant to be
 * moved — a scientist should be able to drag a slider and watch the network re-colour
 * — and that requires re-scoring a filtered view in milliseconds without touching the
 * database again. Evidence is gathered once per query; re-weighting is then pure
 * arithmetic over the gathered rows.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { sqlString } from '../model/schema'
import { normalizeWeights, type TrustConfig } from './model'
import {
  buildImpactNormalizer,
  citationRate,
  scorePair,
  type PairEvidence,
  type PublicationEvidence,
  type ScoringContext,
  type TrustScore,
} from './terms'

/**
 * Separator for values aggregated into a single string by DuckDB. ASCII unit
 * separator: it cannot occur in an experimental system name, so splitting is exact.
 */
const AGG_SEPARATOR = String.fromCharCode(0x1f)

export interface EvidenceQuery {
  readonly datasetId: string
  /** Restrict to interactions touching this organism. */
  readonly organismId?: number
  /** Only pairs whose evidence includes one of these experimental systems. */
  readonly systems?: readonly string[]
  /** Drop pairs with no physical evidence. */
  readonly physicalOnly?: boolean
  /** Drop self-interactions. */
  readonly excludeSelfInteractions?: boolean
  /** Cap the number of pairs returned, most-evidenced first. */
  readonly limit?: number
}

function whereClause(query: EvidenceQuery, alias = 'i'): string {
  const parts = [`${alias}.dataset_id = ${sqlString(query.datasetId)}`, `${alias}.pair_key IS NOT NULL`]
  if (query.organismId !== undefined) {
    parts.push(
      `(${alias}.organism_id_a = ${query.organismId} OR ${alias}.organism_id_b = ${query.organismId})`,
    )
  }
  if (query.systems?.length) {
    const list = query.systems.map(sqlString).join(', ')
    parts.push(`${alias}.experimental_system IN (${list})`)
  }
  if (query.excludeSelfInteractions) {
    parts.push(`NOT ${alias}.is_self_interaction`)
  }
  return parts.join(' AND ')
}

interface PairRow {
  pair_key: string
  symbol_lo: string | null
  symbol_hi: string | null
  node_lo: bigint | number
  node_hi: bigint | number
  systems: string | null
  low_records: bigint | number
  high_records: bigint | number
  has_physical: boolean
  has_genetic: boolean
}

interface PublicationRow {
  pair_key: string
  publication_key: string
  author_name: string | null
  year: number | null
  institution_rors: string | null
  citation_count: bigint | number | null
}

export interface PairIdentity {
  readonly pairKey: string
  readonly nodeLo: number
  readonly nodeHi: number
  readonly symbolLo: string | null
  readonly symbolHi: string | null
}

export interface GatheredEvidence {
  readonly evidence: readonly PairEvidence[]
  readonly identities: ReadonlyMap<string, PairIdentity>
  /** Citation rates across the whole dataset, used to normalize the impact term. */
  readonly corpusRates: readonly number[]
}

/**
 * Gather everything the model needs, in two queries: one aggregate per pair, one row
 * per (pair, publication). Nested aggregation would save a round trip but makes the
 * Arrow decoding materially harder to verify, and this is the code that decides what
 * a scientist believes.
 */
export async function gatherEvidence(
  engine: DuckDBEngine,
  query: EvidenceQuery,
  config: TrustConfig,
): Promise<GatheredEvidence> {
  const where = whereClause(query)
  const physical = query.physicalOnly
    ? `HAVING bool_or(i.experimental_system_type = 'physical')`
    : ''
  const limit = query.limit === undefined ? '' : `LIMIT ${Math.floor(query.limit)}`

  const pairRows = await engine.rows<PairRow>(`
    SELECT
      i.pair_key,
      i.node_lo,
      i.node_hi,
      any_value(CASE WHEN i.biogrid_id_a = i.node_lo THEN i.symbol_a ELSE i.symbol_b END)
        AS symbol_lo,
      any_value(CASE WHEN i.biogrid_id_a = i.node_hi THEN i.symbol_a ELSE i.symbol_b END)
        AS symbol_hi,
      string_agg(DISTINCT i.experimental_system, ${sqlString(AGG_SEPARATOR)}) AS systems,
      count(*) FILTER (WHERE i.throughput_low)  AS low_records,
      count(*) FILTER (WHERE i.throughput_high) AS high_records,
      bool_or(i.experimental_system_type = 'physical') AS has_physical,
      bool_or(i.experimental_system_type = 'genetic')  AS has_genetic
    FROM interactions i
    WHERE ${where}
    GROUP BY i.pair_key, i.node_lo, i.node_hi
    ${physical}
    ORDER BY count(DISTINCT i.publication_key) DESC, i.pair_key
    ${limit}`)

  const wanted = new Set(pairRows.map((r) => r.pair_key))

  const pubRows = await engine.rows<PublicationRow>(`
    SELECT DISTINCT
      i.pair_key,
      i.publication_key,
      i.author_name,
      i.publication_year AS year,
      l.institution_rors,
      l.citation_count
    FROM interactions i
    LEFT JOIN literature l ON l.publication_key = i.publication_key
    WHERE ${where} AND i.publication_key IS NOT NULL`)

  const byPair = new Map<string, PublicationEvidence[]>()
  for (const row of pubRows) {
    if (!wanted.has(row.pair_key)) continue
    const list = byPair.get(row.pair_key)
    const publication: PublicationEvidence = {
      publicationKey: row.publication_key,
      authorName: row.author_name,
      year: row.year === null ? null : Number(row.year),
      institutionRors: row.institution_rors
        ? row.institution_rors.split('|').filter(Boolean)
        : [],
      citationCount:
        row.citation_count === null || row.citation_count === undefined
          ? null
          : Number(row.citation_count),
    }
    if (list) list.push(publication)
    else byPair.set(row.pair_key, [publication])
  }

  const identities = new Map<string, PairIdentity>()
  const evidence: PairEvidence[] = pairRows.map((row) => {
    identities.set(row.pair_key, {
      pairKey: row.pair_key,
      nodeLo: Number(row.node_lo),
      nodeHi: Number(row.node_hi),
      symbolLo: row.symbol_lo,
      symbolHi: row.symbol_hi,
    })
    return {
      pairKey: row.pair_key,
      systems: row.systems ? row.systems.split(AGG_SEPARATOR).filter(Boolean) : [],
      publications: byPair.get(row.pair_key) ?? [],
      lowThroughputRecords: Number(row.low_records),
      highThroughputRecords: Number(row.high_records),
      hasPhysical: Boolean(row.has_physical),
      hasGenetic: Boolean(row.has_genetic),
    }
  })

  const corpusRates = await gatherCorpusRates(engine, query.datasetId, config)
  return { evidence, identities, corpusRates }
}

/**
 * Citation rates for every resolved publication in the dataset.
 *
 * The impact term is a percentile within this corpus, not an absolute threshold: a
 * citation count that marks a landmark in structural biology is unremarkable in
 * cancer genomics, and a fixed cutoff would encode one field's norms as truth.
 */
async function gatherCorpusRates(
  engine: DuckDBEngine,
  datasetId: string,
  config: TrustConfig,
): Promise<number[]> {
  const rows = await engine.rows<{ citation_count: bigint | number; year: number | null }>(`
    SELECT l.citation_count, coalesce(l.year, p.year) AS year
    FROM publications p
    JOIN literature l ON l.publication_key = p.publication_key
    WHERE p.dataset_id = ${sqlString(datasetId)} AND l.citation_count IS NOT NULL`)

  return rows.map((row) =>
    citationRate(
      {
        publicationKey: '',
        authorName: null,
        year: row.year === null ? null : Number(row.year),
        institutionRors: [],
        citationCount: Number(row.citation_count),
      },
      config.constants,
    ),
  ).filter((r): r is number => r !== null)
}

/** Build a reusable scoring context from a config and a gathered corpus. */
export function scoringContext(
  config: TrustConfig,
  corpusRates: readonly number[],
): ScoringContext {
  return {
    constants: config.constants,
    weights: normalizeWeights(config.weights),
    normalizeImpact: buildImpactNormalizer(corpusRates),
  }
}

/**
 * Score gathered evidence. Cheap enough to re-run on every weight change, which is
 * the point of separating it from `gatherEvidence`.
 */
export function scoreAll(
  gathered: GatheredEvidence,
  config: TrustConfig,
): TrustScore[] {
  const context = scoringContext(config, gathered.corpusRates)
  return gathered.evidence.map((e) => scorePair(e, context))
}

export interface ScoredPair extends TrustScore, PairIdentity {}

/** Score and attach gene identity, for display and export. */
export function scoreWithIdentity(
  gathered: GatheredEvidence,
  config: TrustConfig,
): ScoredPair[] {
  return scoreAll(gathered, config).map((score) => {
    const identity = gathered.identities.get(score.pairKey)
    return {
      ...score,
      pairKey: score.pairKey,
      nodeLo: identity?.nodeLo ?? 0,
      nodeHi: identity?.nodeHi ?? 0,
      symbolLo: identity?.symbolLo ?? null,
      symbolHi: identity?.symbolHi ?? null,
    }
  })
}

/** Convenience: gather and score in one call. */
export async function scoreDataset(
  engine: DuckDBEngine,
  query: EvidenceQuery,
  config: TrustConfig,
): Promise<ScoredPair[]> {
  const gathered = await gatherEvidence(engine, query, config)
  return scoreWithIdentity(gathered, config)
}
