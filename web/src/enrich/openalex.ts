/**
 * OpenAlex client.
 *
 * OpenAlex is free, needs no key, and sets `Access-Control-Allow-Origin: *`, so a
 * static page can use it directly. It resolves both of BioGRID's publication
 * reference kinds — PubMed ids and DOIs — and uniquely gives us ROR institution
 * identifiers, which is what lets the trust model distinguish "five labs agree" from
 * "one lab published five times".
 *
 * Supplying a contact address puts requests in OpenAlex's faster "polite pool"; it is
 * optional and off unless the user sets one.
 */

import type { LiteratureRecord } from './types'

export const OPENALEX_BASE_URL = 'https://api.openalex.org'

/**
 * Ids per request. OpenAlex accepts up to 100 values in an OR filter; 50 keeps the
 * URL comfortably short given that DOIs can be long.
 */
export const OPENALEX_BATCH_SIZE = 50

const MAILTO_STORAGE = 'prolivis.openalex.mailto'

/** Only these fields are requested, which keeps responses an order smaller. */
const SELECT_FIELDS = [
  'id',
  'doi',
  'ids',
  'display_name',
  'publication_year',
  'cited_by_count',
  'type',
  'primary_location',
  'open_access',
  'authorships',
].join(',')

export function loadContactEmail(): string | null {
  try {
    return localStorage.getItem(MAILTO_STORAGE)
  } catch {
    return null
  }
}

export function saveContactEmail(email: string | null): void {
  try {
    if (email === null || email.trim() === '') localStorage.removeItem(MAILTO_STORAGE)
    else localStorage.setItem(MAILTO_STORAGE, email.trim())
  } catch {
    // Storage unavailable; requests simply use the common pool.
  }
}

interface OpenAlexInstitution {
  ror?: string | null
  display_name?: string | null
}

interface OpenAlexAuthorship {
  author?: { display_name?: string | null } | null
  institutions?: OpenAlexInstitution[] | null
}

interface OpenAlexWork {
  id?: string
  doi?: string | null
  ids?: { pmid?: string | null; doi?: string | null } | null
  display_name?: string | null
  publication_year?: number | null
  cited_by_count?: number | null
  type?: string | null
  primary_location?: { source?: { display_name?: string | null } | null } | null
  open_access?: { is_oa?: boolean | null } | null
  authorships?: OpenAlexAuthorship[] | null
}

interface OpenAlexResponse {
  results?: OpenAlexWork[]
  meta?: { count?: number }
}

/** `https://pubmed.ncbi.nlm.nih.gov/11805826` -> `11805826`. */
export function extractPmid(value: string | null | undefined): string | null {
  if (!value) return null
  const m = /(\d+)\s*$/.exec(value.trim())
  return m?.[1] ?? null
}

/** `https://doi.org/10.1038/415141a` -> `10.1038/415141a`, lower-cased. */
export function extractDoi(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  const m = /(10\.\d{4,9}\/\S+)$/.exec(trimmed)
  return m?.[1] ?? null
}

/** `https://openalex.org/W2084619201` -> `W2084619201`. */
function extractOpenAlexId(value: string | undefined): string | null {
  if (!value) return null
  const m = /(W\d+)\s*$/.exec(value.trim())
  return m?.[1] ?? null
}

/** Map an OpenAlex work onto our record, given the key we looked it up by. */
export function mapWork(work: OpenAlexWork, publicationKey: string): LiteratureRecord {
  const authorships = work.authorships ?? []
  const rors = new Set<string>()
  const names = new Set<string>()
  for (const a of authorships) {
    for (const inst of a.institutions ?? []) {
      if (inst.ror) rors.add(inst.ror.replace(/^https?:\/\/ror\.org\//, ''))
      if (inst.display_name) names.add(inst.display_name)
    }
  }

  return {
    publicationKey,
    provider: 'openalex',
    openalexId: extractOpenAlexId(work.id),
    doi: extractDoi(work.doi ?? work.ids?.doi),
    pmid: extractPmid(work.ids?.pmid),
    title: work.display_name ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    year: work.publication_year ?? null,
    citationCount: work.cited_by_count ?? null,
    isOpenAccess: work.open_access?.is_oa ?? null,
    workType: work.type ?? null,
    firstAuthor: authorships[0]?.author?.display_name ?? null,
    authorCount: authorships.length,
    institutionRors: [...rors],
    institutionNames: [...names],
  }
}

export interface OpenAlexOptions {
  readonly baseUrl?: string
  readonly contactEmail?: string | null
  readonly fetchImpl?: typeof fetch
  /** Attempts per batch before giving up on it. */
  readonly maxRetries?: number
  /** Injected so tests need not actually wait out a backoff. */
  readonly sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class OpenAlexClient {
  private readonly baseUrl: string
  private readonly doFetch: typeof fetch
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: OpenAlexOptions = {}) {
    this.baseUrl = (options.baseUrl ?? OPENALEX_BASE_URL).replace(/\/$/, '')
    this.doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.maxRetries = options.maxRetries ?? 3
    this.sleep = options.sleep ?? defaultSleep
  }

  private url(filter: string): string {
    const params = new URLSearchParams({
      filter,
      select: SELECT_FIELDS,
      'per-page': String(OPENALEX_BATCH_SIZE * 2),
    })
    const mailto = this.options.contactEmail ?? loadContactEmail()
    if (mailto) params.set('mailto', mailto)
    return `${this.baseUrl}/works?${params.toString()}`
  }

  private async getJson(url: string): Promise<OpenAlexResponse> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response: Response
      try {
        response = await this.doFetch(url)
      } catch (cause) {
        lastError = new Error(`OpenAlex unreachable: ${String(cause)}`)
        // Offline is not retryable in any useful sense, but a transient DNS blip is;
        // one backoff round is a fair compromise.
        await this.sleep(500 * 2 ** attempt)
        continue
      }

      // OpenAlex asks clients to back off rather than hammer.
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`OpenAlex returned HTTP ${response.status}`)
        const retryAfter = Number(response.headers.get('retry-after'))
        await this.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 500 * 2 ** attempt,
        )
        continue
      }

      if (!response.ok) {
        throw new Error(`OpenAlex returned HTTP ${response.status}`)
      }
      return (await response.json()) as OpenAlexResponse
    }

    throw lastError ?? new Error('OpenAlex request failed')
  }

  /**
   * Look up works by PubMed id. Returns only those found; callers treat an absent key
   * as "not in OpenAlex" and may fall back to PubMed.
   */
  async byPmid(pmids: readonly string[]): Promise<LiteratureRecord[]> {
    if (pmids.length === 0) return []
    const body = await this.getJson(this.url(`pmid:${pmids.join('|')}`))
    const wanted = new Set(pmids)
    const out: LiteratureRecord[] = []
    for (const work of body.results ?? []) {
      const pmid = extractPmid(work.ids?.pmid)
      if (pmid && wanted.has(pmid)) out.push(mapWork(work, `pubmed:${pmid}`))
    }
    return out
  }

  /** Look up works by DOI. BioGRID references a fifth of its records this way. */
  async byDoi(dois: readonly string[]): Promise<LiteratureRecord[]> {
    if (dois.length === 0) return []
    const body = await this.getJson(this.url(`doi:${dois.join('|')}`))
    const wanted = new Set(dois.map((d) => d.toLowerCase()))
    const out: LiteratureRecord[] = []
    for (const work of body.results ?? []) {
      const doi = extractDoi(work.doi ?? work.ids?.doi)
      if (doi && wanted.has(doi)) out.push(mapWork(work, `doi:${doi}`))
    }
    return out
  }
}

/** Split a list into batches of at most `size`. */
export function batched<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
