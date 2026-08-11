/**
 * NCBI E-utilities client, used as a fallback when OpenAlex does not know a PubMed id.
 *
 * PubMed gives title, journal, date and authors but no citation count, so a record
 * sourced here contributes to the trust model's descriptive fields while leaving the
 * literature-impact term unscored — which is honest: we do not know the impact rather
 * than knowing it to be zero.
 *
 * `pmcrefcount` is deliberately not used as a citation proxy. It counts only citations
 * from PubMed Central, so it systematically understates non-open-access literature and
 * would bias the score by access model rather than by influence.
 */

import type { LiteratureRecord } from './types'

export const EUTILS_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

/** NCBI accepts large id lists; 200 is well within the documented GET limit. */
export const PUBMED_BATCH_SIZE = 200

interface ESummaryRecord {
  uid?: string
  title?: string
  source?: string
  fulljournalname?: string
  pubdate?: string
  epubdate?: string
  sortfirstauthor?: string
  authors?: { name?: string }[]
  articleids?: { idtype?: string; value?: string }[]
}

interface ESummaryResponse {
  result?: Record<string, ESummaryRecord | string[]> & { uids?: string[] }
  error?: string
}

/** `2003 Dec 12` / `2003` / `2003 Dec` all yield 2003. */
export function parsePubDateYear(value: string | undefined): number | null {
  if (!value) return null
  const m = /(\d{4})/.exec(value)
  if (!m?.[1]) return null
  const year = Number(m[1])
  return year >= 1500 && year <= 2200 ? year : null
}

export interface PubMedOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  /** NCBI raises the rate limit for requests carrying an API key. */
  readonly apiKey?: string | null
  readonly toolName?: string
  readonly contactEmail?: string | null
}

export class PubMedClient {
  private readonly baseUrl: string
  private readonly doFetch: typeof fetch

  constructor(private readonly options: PubMedOptions = {}) {
    this.baseUrl = (options.baseUrl ?? EUTILS_BASE_URL).replace(/\/$/, '')
    this.doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async byPmid(pmids: readonly string[]): Promise<LiteratureRecord[]> {
    if (pmids.length === 0) return []

    const params = new URLSearchParams({
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'json',
    })
    // NCBI asks callers to identify themselves; both fields are optional.
    if (this.options.toolName) params.set('tool', this.options.toolName)
    if (this.options.contactEmail) params.set('email', this.options.contactEmail)
    if (this.options.apiKey) params.set('api_key', this.options.apiKey)

    const response = await this.doFetch(`${this.baseUrl}/esummary.fcgi?${params}`)
    if (!response.ok) {
      throw new Error(`PubMed returned HTTP ${response.status}`)
    }
    const body = (await response.json()) as ESummaryResponse
    const result = body.result
    if (!result) return []

    const uids = Array.isArray(result['uids']) ? (result['uids'] as string[]) : []
    const out: LiteratureRecord[] = []

    for (const uid of uids) {
      const record = result[uid]
      if (!record || Array.isArray(record)) continue
      const r = record as ESummaryRecord
      // An id NCBI does not recognize comes back with no title; skip rather than
      // caching an empty shell that looks enriched.
      if (!r.title && !r.source) continue

      const doi = r.articleids?.find((a) => a.idtype === 'doi')?.value ?? null
      out.push({
        publicationKey: `pubmed:${uid}`,
        provider: 'pubmed',
        openalexId: null,
        doi: doi ? doi.toLowerCase() : null,
        pmid: uid,
        title: r.title ?? null,
        venue: r.fulljournalname ?? r.source ?? null,
        year: parsePubDateYear(r.pubdate ?? r.epubdate),
        // PubMed does not report citations, and pmcrefcount is not a fair substitute.
        citationCount: null,
        isOpenAccess: null,
        workType: null,
        firstAuthor: r.sortfirstauthor ?? r.authors?.[0]?.name ?? null,
        authorCount: r.authors?.length ?? null,
        institutionRors: [],
        institutionNames: [],
      })
    }
    return out
  }
}
