/**
 * BioGRID REST client — "online mode".
 *
 * The service sets `Access-Control-Allow-Origin: *`, so a static page can call it
 * directly with no proxy and no server of our own. That is what makes zero-install
 * online mode possible at all.
 *
 * We request `format=tab2&includeHeader=true` rather than JSON. The REST service does
 * not offer tab3, and tab2's header line lets the same alias-based column resolver and
 * the same DuckDB ingest path handle API responses and bulk files identically —
 * one parser, one set of derivations, one place for a bug to live. The cost is that
 * tab2 omits the tab3-only columns (accessions, ontology terms, organism names), which
 * load as NULL and are reported to the caller.
 *
 * The access key is the user's own, is stored only in this browser, and is never sent
 * anywhere except thebiogrid.org.
 */

import type { DuckDBEngine } from './duckdb'
import { resolveHeader } from './columns'
import { buildGenesInsert, buildInteractionSelect, buildPublicationsInsert, sqlString } from '../model/schema'

export const BIOGRID_BASE_URL = 'https://webservice.thebiogrid.org'

/** The service refuses anything larger in a single request. */
export const MAX_PAGE_SIZE = 10_000

const ACCESS_KEY_STORAGE = 'prolivis.biogrid.accessKey'

/** BioGRID access keys are 32-character alphanumeric strings. */
export function isWellFormedAccessKey(key: string): boolean {
  return /^[A-Za-z0-9]{32}$/.test(key.trim())
}

export function loadAccessKey(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY_STORAGE)
  } catch {
    return null // storage disabled; the caller must pass a key explicitly
  }
}

export function saveAccessKey(key: string): void {
  try {
    localStorage.setItem(ACCESS_KEY_STORAGE, key.trim())
  } catch {
    // Nothing we can do; the key simply will not persist across reloads.
  }
}

export function clearAccessKey(): void {
  try {
    localStorage.removeItem(ACCESS_KEY_STORAGE)
  } catch {
    // Ignore.
  }
}

export class BioGridApiError extends Error {
  constructor(
    message: string,
    readonly type: string | null = null,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'BioGridApiError'
  }
}

/** Filters accepted by `/interactions/`, in the service's own vocabulary. */
export interface InteractionQuery {
  /** Gene identifiers to search for. */
  readonly geneList?: readonly string[]
  readonly searchNames?: boolean
  readonly searchIds?: boolean
  readonly searchSynonyms?: boolean
  /** NCBI taxonomy ids. Omit for all organisms. */
  readonly taxId?: readonly (number | string)[]
  /** Experimental system names to include, or to exclude when `includeEvidence` is false. */
  readonly evidenceList?: readonly string[]
  readonly includeEvidence?: boolean
  /** Include interactions of the listed genes with everything else. */
  readonly includeInteractors?: boolean
  /** Include interactions *among* the first-order interactors. */
  readonly includeInteractorInteractions?: boolean
  readonly interSpeciesExcluded?: boolean
  readonly selfInteractionsExcluded?: boolean
  readonly throughputTag?: 'low' | 'high' | 'any'
  readonly pubmedList?: readonly string[]
  readonly excludePubmeds?: boolean
  /** Drop interactions from publications reporting more than this many interactions. */
  readonly htpThreshold?: number
  readonly additionalIdentifierTypes?: readonly string[]
  /** Hard cap on records fetched across all pages. */
  readonly maxRecords?: number
}

export interface RestClientOptions {
  readonly accessKey: string
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
}

interface ErrorBody {
  STATUS?: string
  MESSAGES?: string[]
  TYPE?: string
}

/** Turn a query into the service's query-string parameters. */
export function buildInteractionParams(
  query: InteractionQuery,
  accessKey: string,
  start: number,
  max: number,
): URLSearchParams {
  const p = new URLSearchParams()
  p.set('accessKey', accessKey)
  p.set('format', 'tab2')
  p.set('includeHeader', 'true')
  p.set('start', String(start))
  p.set('max', String(max))

  const list = (values: readonly (string | number)[]) => values.join('|')
  const bool = (v: boolean) => (v ? 'true' : 'false')

  if (query.geneList?.length) p.set('geneList', list(query.geneList))
  if (query.searchNames !== undefined) p.set('searchNames', bool(query.searchNames))
  if (query.searchIds !== undefined) p.set('searchIds', bool(query.searchIds))
  if (query.searchSynonyms !== undefined)
    p.set('searchSynonyms', bool(query.searchSynonyms))
  if (query.taxId?.length) p.set('taxId', list(query.taxId))
  if (query.evidenceList?.length) p.set('evidenceList', list(query.evidenceList))
  if (query.includeEvidence !== undefined)
    p.set('includeEvidence', bool(query.includeEvidence))
  if (query.includeInteractors !== undefined)
    p.set('includeInteractors', bool(query.includeInteractors))
  if (query.includeInteractorInteractions !== undefined)
    p.set('includeInteractorInteractions', bool(query.includeInteractorInteractions))
  if (query.interSpeciesExcluded !== undefined)
    p.set('interSpeciesExcluded', bool(query.interSpeciesExcluded))
  if (query.selfInteractionsExcluded !== undefined)
    p.set('selfInteractionsExcluded', bool(query.selfInteractionsExcluded))
  if (query.throughputTag) p.set('throughputTag', query.throughputTag)
  if (query.pubmedList?.length) p.set('pubmedList', list(query.pubmedList))
  if (query.excludePubmeds !== undefined)
    p.set('excludePubmeds', bool(query.excludePubmeds))
  if (query.htpThreshold !== undefined) p.set('htpThreshold', String(query.htpThreshold))
  if (query.additionalIdentifierTypes?.length)
    p.set('additionalIdentifierTypes', list(query.additionalIdentifierTypes))

  return p
}

/** A human-readable rendering of a query, stored as dataset provenance. */
export function describeQuery(query: InteractionQuery): string {
  const parts: string[] = []
  if (query.geneList?.length) parts.push(`genes=${query.geneList.join(',')}`)
  if (query.taxId?.length) parts.push(`taxId=${query.taxId.join(',')}`)
  if (query.evidenceList?.length)
    parts.push(
      `${query.includeEvidence === false ? 'excluding' : 'evidence'}=` +
        query.evidenceList.join(','),
    )
  if (query.throughputTag && query.throughputTag !== 'any')
    parts.push(`throughput=${query.throughputTag}`)
  if (query.includeInteractors === false) parts.push('interactorsOnly')
  if (query.interSpeciesExcluded) parts.push('sameSpeciesOnly')
  if (query.selfInteractionsExcluded) parts.push('noSelfInteractions')
  if (query.htpThreshold !== undefined) parts.push(`htpThreshold=${query.htpThreshold}`)
  return parts.length > 0 ? parts.join(' ') : 'all interactions'
}

export class BioGridRestClient {
  private readonly baseUrl: string
  private readonly doFetch: typeof fetch

  constructor(private readonly options: RestClientOptions) {
    this.baseUrl = (options.baseUrl ?? BIOGRID_BASE_URL).replace(/\/$/, '')
    this.doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  private async get(path: string, params: URLSearchParams): Promise<string> {
    // The trailing slash matches the documented endpoints; without it the service
    // answers with a redirect that a cross-origin fetch will not follow.
    const url = `${this.baseUrl}/${path}/?${params.toString()}`
    let response: Response
    try {
      response = await this.doFetch(url)
    } catch (cause) {
      // A network-level failure here is usually offline or a blocked request, not a
      // BioGRID problem; say so rather than reporting a bare "Failed to fetch".
      throw new BioGridApiError(
        `Could not reach ${this.baseUrl}. Check your connection, or use offline mode ` +
          `by dropping in a BioGRID download. (${String(cause)})`,
      )
    }

    const text = await response.text()

    // Errors come back as JSON even when a tabular format was requested.
    if (text.startsWith('{')) {
      let body: ErrorBody | null = null
      try {
        body = JSON.parse(text) as ErrorBody
      } catch {
        body = null
      }
      if (body?.STATUS === 'ERROR' || body?.MESSAGES) {
        throw new BioGridApiError(
          body.MESSAGES?.join(' ') ?? 'BioGRID returned an error',
          body.TYPE ?? null,
          response.status,
        )
      }
    }

    if (!response.ok) {
      throw new BioGridApiError(
        `BioGRID returned HTTP ${response.status}`,
        null,
        response.status,
      )
    }
    return text
  }

  /** Current BioGRID release, e.g. `5.0.260`. Also the cheapest key validation. */
  async version(): Promise<string> {
    const params = new URLSearchParams({ accessKey: this.options.accessKey })
    const text = await this.get('version', params)
    return text.trim().replace(/^"|"$/g, '')
  }

  /** Taxonomy id to organism name, for the organism picker. */
  async organisms(): Promise<Map<number, string>> {
    const params = new URLSearchParams({
      accessKey: this.options.accessKey,
      format: 'tab2',
    })
    const text = await this.get('organisms', params)
    const map = new Map<number, string>()
    for (const line of text.split('\n')) {
      const [id, name] = line.split('\t')
      if (id && name && /^\d+$/.test(id.trim())) {
        map.set(Number(id.trim()), name.trim())
      }
    }
    return map
  }

  /** Experimental system names the service will accept in `evidenceList`. */
  async evidenceTypes(): Promise<string[]> {
    const params = new URLSearchParams({
      accessKey: this.options.accessKey,
      format: 'tab2',
    })
    const text = await this.get('evidence', params)
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
  }

  /** Number of interactions a query would return, without fetching them. */
  async count(query: InteractionQuery): Promise<number> {
    const params = buildInteractionParams(query, this.options.accessKey, 0, 1)
    params.set('format', 'count')
    params.delete('includeHeader')
    const text = await this.get('interactions', params)
    const n = Number(text.trim())
    if (!Number.isFinite(n)) {
      throw new BioGridApiError(`Unexpected count response: ${text.slice(0, 120)}`)
    }
    return n
  }

  /**
   * Fetch interactions page by page, yielding each page's raw tab2 text.
   *
   * Pages are yielded rather than accumulated so the caller can insert each one and
   * discard it: a broad query can exceed a million records, which must never all sit
   * in memory at once.
   */
  async *pages(
    query: InteractionQuery,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<{ text: string; start: number; recordsSoFar: number }> {
    const pageSize = Math.min(MAX_PAGE_SIZE, query.maxRecords ?? MAX_PAGE_SIZE)
    let start = 0
    let recordsSoFar = 0

    for (;;) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const remaining =
        query.maxRecords === undefined ? pageSize : query.maxRecords - recordsSoFar
      if (remaining <= 0) return

      const max = Math.min(pageSize, remaining)
      const params = buildInteractionParams(query, this.options.accessKey, start, max)
      const text = await this.get('interactions', params)

      // Header line plus data lines; a page with only a header means we are done.
      const lines = text.split('\n').filter((l) => l.trim() !== '')
      const dataLines = Math.max(0, lines.length - 1)
      if (dataLines === 0) return

      recordsSoFar += dataLines
      yield { text, start, recordsSoFar }

      // A short page means the result set is exhausted.
      if (dataLines < max) return
      start += dataLines
    }
  }
}

export interface RestIngestProgress {
  readonly recordsLoaded: number
  readonly expectedRecords: number | null
  readonly message: string
}

export interface RestIngestOptions {
  readonly label?: string
  readonly onProgress?: (p: RestIngestProgress) => void
  readonly signal?: AbortSignal
}

export interface RestIngestResult {
  readonly datasetId: string
  readonly label: string
  readonly recordCount: number
  readonly biogridRelease: string | null
  /** Canonical columns tab2 does not carry; these are NULL for this dataset. */
  readonly absentColumns: readonly string[]
}

let restCounter = 0

/**
 * Run a query and load the results as a dataset, using the same tables and the same
 * derivations as a file ingest.
 */
export async function ingestFromRest(
  engine: DuckDBEngine,
  client: BioGridRestClient,
  query: InteractionQuery,
  options: RestIngestOptions = {},
): Promise<RestIngestResult> {
  restCounter += 1
  const datasetId = `rest${restCounter}_${Math.random().toString(36).slice(2, 8)}`
  const report = options.onProgress ?? (() => undefined)
  const description = describeQuery(query)

  // Fetch the release first: it is provenance, and it validates the key before we
  // start creating rows.
  let release: string | null = null
  try {
    release = await client.version()
  } catch (error) {
    if (error instanceof BioGridApiError) throw error
    release = null
  }

  let expected: number | null = null
  try {
    expected = await client.count(query)
  } catch {
    expected = null // /count is advisory; a failure must not block the fetch
  }

  const label = options.label ?? `BioGRID ${release ?? 'REST'}: ${description}`

  await engine.exec(`
    INSERT INTO datasets (dataset_id, label, source_kind, source_detail, biogrid_release,
                          loaded_at, record_count)
    VALUES (${sqlString(datasetId)}, ${sqlString(label)}, 'rest',
            ${sqlString(description)},
            ${release === null ? 'NULL' : sqlString(release)},
            now(), 0)`)

  let recordsLoaded = 0
  let pageIndex = 0
  const absent = new Set<string>()

  try {
    report({ recordsLoaded: 0, expectedRecords: expected, message: 'Querying BioGRID' })

    for await (const page of client.pages(query, { signal: options.signal ?? undefined })) {
      const newline = page.text.indexOf('\n')
      if (newline === -1) continue
      const headerLine = page.text.slice(0, newline)
      const header = resolveHeader(headerLine)
      for (const column of header.absent) absent.add(column)

      const registered = `${datasetId}_page${pageIndex}.tsv`
      pageIndex += 1
      await engine.registerBuffer(registered, new TextEncoder().encode(page.text))
      try {
        recordsLoaded += await engine.execCount(
          `INSERT INTO interactions ${buildInteractionSelect(header, datasetId, registered)}`,
        )
      } finally {
        await engine.dropFile(registered)
      }

      report({
        recordsLoaded,
        expectedRecords: expected,
        message: `Fetched ${recordsLoaded.toLocaleString()} records`,
      })
    }

    await engine.exec(buildGenesInsert(datasetId))
    await engine.exec(buildPublicationsInsert(datasetId))
    await engine.createIndexes()
    await engine.exec(
      `UPDATE datasets SET record_count = ${recordsLoaded}
       WHERE dataset_id = ${sqlString(datasetId)}`,
    )

    return {
      datasetId,
      label,
      recordCount: recordsLoaded,
      biogridRelease: release,
      absentColumns: [...absent],
    }
  } catch (error) {
    for (const table of ['interactions', 'genes', 'publications', 'datasets']) {
      await engine
        .exec(`DELETE FROM ${table} WHERE dataset_id = ${sqlString(datasetId)}`)
        .catch(() => undefined)
    }
    throw error
  }
}
