/**
 * Literature enrichment: fill the `literature` cache for the publications BioGRID
 * cites, so the trust model can ask how well-cited and how independent the supporting
 * papers are.
 *
 * Everything here degrades: enrichment is optional, failures are per-batch rather than
 * fatal, and a publication nobody can resolve is recorded as *unknown* rather than as
 * zero citations. The distinction matters — scoring an unresolvable paper as
 * uncited would penalise older and non-indexed literature for our ignorance.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { sqlString } from '../model/schema'
import { batched, OpenAlexClient, OPENALEX_BATCH_SIZE } from './openalex'
import { PubMedClient, PUBMED_BATCH_SIZE } from './pubmed'
import type { EnrichmentProgress, LiteratureRecord } from './types'

export interface EnrichOptions {
  /** Restrict to one dataset's publications. Omit to enrich everything loaded. */
  readonly datasetId?: string
  /** Re-fetch even publications already cached. */
  readonly refresh?: boolean
  /** Stop after this many publications; useful for a quick partial enrichment. */
  readonly limit?: number
  readonly onProgress?: (p: EnrichmentProgress) => void
  readonly signal?: AbortSignal
  readonly openAlex?: OpenAlexClient
  readonly pubMed?: PubMedClient
  /** Skip the PubMed fallback for ids OpenAlex does not know. */
  readonly skipPubMedFallback?: boolean
}

export interface EnrichResult {
  readonly requested: number
  readonly fromOpenAlex: number
  readonly fromPubMed: number
  readonly notFound: number
  /** Batches that failed outright; their publications remain un-enriched. */
  readonly failedBatches: number
}

/** Publications still lacking a `literature` row. */
export async function pendingPublicationKeys(
  engine: DuckDBEngine,
  options: EnrichOptions = {},
): Promise<string[]> {
  const dataset =
    options.datasetId === undefined
      ? ''
      : `AND p.dataset_id = ${sqlString(options.datasetId)}`
  const cached = options.refresh
    ? ''
    : 'AND NOT EXISTS (SELECT 1 FROM literature l WHERE l.publication_key = p.publication_key)'
  const limit = options.limit === undefined ? '' : `LIMIT ${Math.floor(options.limit)}`

  const rows = await engine.rows<{ publication_key: string }>(`
    SELECT DISTINCT p.publication_key
    FROM publications p
    WHERE p.publication_key IS NOT NULL
      -- 'other:' references are neither PubMed ids nor DOIs; nothing to look up.
      AND (p.ref_kind = 'pubmed' OR p.ref_kind = 'doi')
      ${dataset}
      ${cached}
    ORDER BY p.publication_key
    ${limit}`)

  return rows.map((r) => r.publication_key)
}

/** Fetch metadata for every un-enriched publication and cache it. */
export async function enrichLiterature(
  engine: DuckDBEngine,
  options: EnrichOptions = {},
): Promise<EnrichResult> {
  const report = options.onProgress ?? (() => undefined)
  const openAlex = options.openAlex ?? new OpenAlexClient()
  const pubMed = options.pubMed ?? new PubMedClient({ toolName: 'ProLiVis' })

  const keys = await pendingPublicationKeys(engine, options)
  const total = keys.length
  if (total === 0) {
    return { requested: 0, fromOpenAlex: 0, fromPubMed: 0, notFound: 0, failedBatches: 0 }
  }

  const pmids = keys.filter((k) => k.startsWith('pubmed:')).map((k) => k.slice(7))
  const dois = keys.filter((k) => k.startsWith('doi:')).map((k) => k.slice(4))

  const found = new Map<string, LiteratureRecord>()
  let failedBatches = 0
  let fetched = 0

  const checkAbort = () => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  }

  const runBatches = async <T>(
    items: readonly T[],
    size: number,
    fetch: (batch: T[]) => Promise<LiteratureRecord[]>,
    label: string,
  ) => {
    for (const batch of batched(items, size)) {
      checkAbort()
      try {
        const records = await fetch(batch)
        for (const record of records) found.set(record.publicationKey, record)
      } catch {
        // One bad batch must not abandon the rest; the publications it covered stay
        // un-enriched and will be retried next time.
        failedBatches += 1
      }
      fetched += batch.length
      report({
        fetched: Math.min(fetched, total),
        total,
        message: `${label}: ${found.size.toLocaleString()} of ${total.toLocaleString()} resolved`,
      })
    }
  }

  await runBatches(pmids, OPENALEX_BATCH_SIZE, (b) => openAlex.byPmid(b), 'OpenAlex')
  await runBatches(dois, OPENALEX_BATCH_SIZE, (b) => openAlex.byDoi(b), 'OpenAlex')
  const fromOpenAlex = found.size

  // PubMed covers ids OpenAlex has not indexed — mostly older or very recent papers.
  if (!options.skipPubMedFallback) {
    const missingPmids = pmids.filter((id) => !found.has(`pubmed:${id}`))
    if (missingPmids.length > 0) {
      fetched = 0
      await runBatches(
        missingPmids,
        PUBMED_BATCH_SIZE,
        (b) => pubMed.byPmid(b),
        'PubMed',
      )
    }
  }
  const fromPubMed = found.size - fromOpenAlex

  await writeLiterature(engine, [...found.values()])

  // Record the misses too, so a second run does not re-ask the same questions.
  const misses = keys.filter((k) => !found.has(k))
  await writeMisses(engine, misses)

  report({ fetched: total, total, message: 'Enrichment complete' })

  return {
    requested: total,
    fromOpenAlex,
    fromPubMed,
    notFound: misses.length,
    failedBatches,
  }
}

const PIPE = '|'

/** Insert or replace cached literature rows. */
export async function writeLiterature(
  engine: DuckDBEngine,
  records: readonly LiteratureRecord[],
): Promise<void> {
  if (records.length === 0) return

  const lit = (v: string | null | undefined) => (v == null ? 'NULL' : sqlString(v))
  const numeric = (v: number | null | undefined) => (v == null ? 'NULL' : String(v))
  const bool = (v: boolean | null | undefined) =>
    v == null ? 'NULL' : v ? 'TRUE' : 'FALSE'

  // Chunked so a large enrichment does not build one enormous SQL statement.
  for (const chunk of batched(records, 400)) {
    const values = chunk
      .map((r) =>
        [
          sqlString(r.publicationKey),
          lit(r.provider),
          lit(r.openalexId),
          lit(r.doi),
          lit(r.pmid),
          lit(r.title),
          lit(r.venue),
          numeric(r.year),
          numeric(r.citationCount),
          bool(r.isOpenAccess),
          lit(r.workType),
          lit(r.firstAuthor),
          numeric(r.authorCount),
          lit(r.institutionRors.length > 0 ? r.institutionRors.join(PIPE) : null),
          lit(r.institutionNames.length > 0 ? r.institutionNames.join(PIPE) : null),
          'now()',
          'TRUE',
        ].join(', '),
      )
      .map((row) => `(${row})`)
      .join(',\n')

    await engine.exec(`INSERT OR REPLACE INTO literature VALUES\n${values}`)
  }
}

/** Record publications that no provider could resolve. */
async function writeMisses(engine: DuckDBEngine, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  for (const chunk of batched(keys, 800)) {
    const values = chunk
      .map(
        (k) =>
          `(${sqlString(k)}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ` +
          `NULL, NULL, NULL, NULL, NULL, now(), FALSE)`,
      )
      .join(',\n')
    await engine.exec(`INSERT OR REPLACE INTO literature VALUES\n${values}`)
  }
}

export interface EnrichmentCoverage {
  readonly publications: number
  readonly enriched: number
  readonly withCitations: number
  readonly withInstitutions: number
  readonly notFound: number
}

/**
 * How much of a dataset's literature is resolved.
 *
 * Surfaced in the UI because it bounds what the trust model can claim: with 40%
 * coverage, the literature-impact and independence terms are informed for 40% of
 * publications and neutral for the rest, and a reader deserves to know that.
 */
export async function enrichmentCoverage(
  engine: DuckDBEngine,
  datasetId?: string,
): Promise<EnrichmentCoverage> {
  const filter =
    datasetId === undefined ? '' : `WHERE p.dataset_id = ${sqlString(datasetId)}`
  const row = await engine.row<Record<string, bigint | number>>(`
    SELECT
      count(DISTINCT p.publication_key)                                   AS publications,
      count(DISTINCT p.publication_key) FILTER (WHERE l.found)            AS enriched,
      count(DISTINCT p.publication_key) FILTER (WHERE l.citation_count IS NOT NULL)
                                                                          AS with_citations,
      count(DISTINCT p.publication_key) FILTER (WHERE l.institution_rors IS NOT NULL)
                                                                          AS with_institutions,
      count(DISTINCT p.publication_key) FILTER (WHERE l.found = FALSE)    AS not_found
    FROM publications p
    LEFT JOIN literature l ON l.publication_key = p.publication_key
    ${filter}`)

  const n = (v: bigint | number | undefined) => Number(v ?? 0)
  return {
    publications: n(row?.['publications']),
    enriched: n(row?.['enriched']),
    withCitations: n(row?.['with_citations']),
    withInstitutions: n(row?.['with_institutions']),
    notFound: n(row?.['not_found']),
  }
}
