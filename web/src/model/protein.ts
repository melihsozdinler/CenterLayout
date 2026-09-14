/**
 * Everything known about one protein's interactions.
 *
 * This is what a click should produce. A highlighted neighbourhood tells you *that*
 * a protein has partners; this tells you which, on whose authority, by what method,
 * and how much of it has ever been replicated.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { sqlString } from './schema'

const SEP = String.fromCharCode(0x1f)

export interface PartnerEvidence {
  readonly pairKey: string
  readonly partnerId: number
  readonly partnerSymbol: string | null
  readonly partnerOrganism: string | null
  readonly publicationCount: number
  readonly systemCount: number
  readonly recordCount: number
  readonly systems: readonly string[]
  /** Author labels, e.g. `Gavin AC (2002)`. */
  readonly publications: readonly string[]
  readonly firstYear: number | null
  readonly lastYear: number | null
  readonly lowThroughput: number
  readonly highThroughput: number
  readonly hasPhysical: boolean
  readonly hasGenetic: boolean
  /** Filled in by the caller from the trust model, which is not a database concern. */
  trust?: number
}

export interface ProteinDetail {
  readonly biogridId: number
  readonly symbol: string | null
  readonly systematic: string | null
  readonly entrez: string | null
  readonly organism: string | null
  readonly organismId: number | null
  readonly synonyms: readonly string[]
  readonly swissprot: readonly string[]
  readonly partners: readonly PartnerEvidence[]
  /** Distinct partners, before any filter the view applies. */
  readonly partnerCount: number
}

interface GeneRow {
  symbol: string | null
  systematic: string | null
  entrez: string | null
  synonyms: string | null
  organism_name: string | null
  organism_id: number | null
  swissprot: string | null
}

interface PartnerRow {
  pair_key: string
  partner_id: bigint | number
  partner_symbol: string | null
  partner_organism: string | null
  publication_count: bigint | number
  system_count: bigint | number
  record_count: bigint | number
  systems: string | null
  publications: string | null
  first_year: number | null
  last_year: number | null
  low_throughput: bigint | number
  high_throughput: bigint | number
  has_physical: boolean
  has_genetic: boolean
}

const num = (v: bigint | number | null | undefined) => Number(v ?? 0)
const split = (v: string | null) => (v ? v.split(SEP).filter(Boolean) : [])

/** Look up one protein and every interaction it takes part in. */
export async function proteinDetail(
  engine: DuckDBEngine,
  datasetId: string,
  biogridId: number,
): Promise<ProteinDetail | null> {
  const id = sqlString(datasetId)

  const gene = await engine.row<GeneRow>(`
    SELECT symbol, systematic, entrez, synonyms, organism_name, organism_id, swissprot
    FROM genes WHERE dataset_id = ${id} AND biogrid_id = ${biogridId}`)
  if (!gene) return null

  // Grouped per partner rather than per record: an interaction supported by twenty
  // records is one row with twenty pieces of evidence, not twenty rows.
  const partners = await engine.rows<PartnerRow>(`
    SELECT
      pair_key,
      CASE WHEN node_lo = ${biogridId} THEN node_hi ELSE node_lo END AS partner_id,
      any_value(
        CASE WHEN biogrid_id_a = ${biogridId} THEN symbol_b ELSE symbol_a END
      )                                                             AS partner_symbol,
      any_value(
        CASE WHEN biogrid_id_a = ${biogridId} THEN organism_name_b ELSE organism_name_a END
      )                                                             AS partner_organism,
      count(DISTINCT publication_key)                               AS publication_count,
      count(DISTINCT experimental_system)                           AS system_count,
      count(*)                                                      AS record_count,
      string_agg(DISTINCT experimental_system, ${sqlString(SEP)})    AS systems,
      string_agg(DISTINCT author, ${sqlString(SEP)})                 AS publications,
      min(publication_year)                                         AS first_year,
      max(publication_year)                                         AS last_year,
      count(*) FILTER (WHERE throughput_low)                        AS low_throughput,
      count(*) FILTER (WHERE throughput_high)                       AS high_throughput,
      bool_or(experimental_system_type = 'physical')                AS has_physical,
      bool_or(experimental_system_type = 'genetic')                 AS has_genetic
    FROM interactions
    WHERE dataset_id = ${id}
      AND (biogrid_id_a = ${biogridId} OR biogrid_id_b = ${biogridId})
      AND pair_key IS NOT NULL
    GROUP BY pair_key, node_lo, node_hi
    ORDER BY publication_count DESC, record_count DESC`)

  return {
    biogridId,
    symbol: gene.symbol,
    systematic: gene.systematic,
    entrez: gene.entrez,
    organism: gene.organism_name,
    organismId: gene.organism_id === null ? null : Number(gene.organism_id),
    // BioGRID pipe-joins these, unlike the aggregates above.
    synonyms: gene.synonyms ? gene.synonyms.split('|').filter(Boolean) : [],
    swissprot: gene.swissprot ? gene.swissprot.split('|').filter(Boolean) : [],
    partners: partners.map((row) => ({
      pairKey: row.pair_key,
      partnerId: num(row.partner_id),
      partnerSymbol: row.partner_symbol,
      partnerOrganism: row.partner_organism,
      publicationCount: num(row.publication_count),
      systemCount: num(row.system_count),
      recordCount: num(row.record_count),
      systems: split(row.systems),
      publications: split(row.publications),
      firstYear: row.first_year === null ? null : Number(row.first_year),
      lastYear: row.last_year === null ? null : Number(row.last_year),
      lowThroughput: num(row.low_throughput),
      highThroughput: num(row.high_throughput),
      hasPhysical: Boolean(row.has_physical),
      hasGenetic: Boolean(row.has_genetic),
    })),
    partnerCount: partners.length,
  }
}

/** Find a protein by symbol, for the search box. */
export async function findProteins(
  engine: DuckDBEngine,
  datasetId: string,
  query: string,
  limit = 20,
): Promise<{ biogridId: number; symbol: string; organism: string | null }[]> {
  const term = query.trim()
  if (term === '') return []

  const rows = await engine.rows<{
    biogrid_id: bigint | number
    symbol: string
    organism_name: string | null
  }>(`
    SELECT biogrid_id, symbol, organism_name
    FROM genes
    WHERE dataset_id = ${sqlString(datasetId)}
      AND symbol IS NOT NULL
      AND (upper(symbol) LIKE ${sqlString(`${term.toUpperCase()}%`)}
        OR upper(coalesce(synonyms, '')) LIKE ${sqlString(`%${term.toUpperCase()}%`)})
    -- Exact matches first: typing 'TP53' should not bury it under 'TP53BP1'.
    ORDER BY CASE WHEN upper(symbol) = ${sqlString(term.toUpperCase())} THEN 0 ELSE 1 END,
             length(symbol), symbol
    LIMIT ${Math.floor(limit)}`)

  return rows.map((r) => ({
    biogridId: Number(r.biogrid_id),
    symbol: r.symbol,
    organism: r.organism_name,
  }))
}
