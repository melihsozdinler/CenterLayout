import { describe, expect, it, vi } from 'vitest'
import {
  batched,
  extractDoi,
  extractPmid,
  mapWork,
  OpenAlexClient,
} from '@/enrich/openalex'
import { parsePubDateYear, PubMedClient } from '@/enrich/pubmed'

/** A response shaped exactly like the live OpenAlex one, verified against the API. */
const GAVIN_2002 = {
  id: 'https://openalex.org/W2084619201',
  doi: 'https://doi.org/10.1038/415141a',
  ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/11805826', doi: 'https://doi.org/10.1038/415141a' },
  display_name: 'Functional organization of the yeast proteome',
  publication_year: 2002,
  cited_by_count: 4799,
  type: 'article',
  primary_location: { source: { display_name: 'Nature' } },
  open_access: { is_oa: true },
  authorships: [
    {
      author: { display_name: 'Anne-Claude Gavin' },
      institutions: [
        { ror: 'https://ror.org/008pyjt05', display_name: 'Centre National de la Recherche Scientifique' },
      ],
    },
    {
      author: { display_name: 'Markus Bösche' },
      institutions: [
        { ror: 'https://ror.org/02feahw73', display_name: 'Centre de Génétique Moléculaire' },
        // Repeated institution must collapse, not double-count.
        { ror: 'https://ror.org/008pyjt05', display_name: 'Centre National de la Recherche Scientifique' },
      ],
    },
  ],
}

describe('identifier extraction', () => {
  it('pulls a PubMed id out of the URL OpenAlex returns', () => {
    expect(extractPmid('https://pubmed.ncbi.nlm.nih.gov/11805826')).toBe('11805826')
    expect(extractPmid('11805826')).toBe('11805826')
    expect(extractPmid(null)).toBeNull()
  })

  it('pulls a DOI out of the URL and lower-cases it', () => {
    expect(extractDoi('https://doi.org/10.1038/415141A')).toBe('10.1038/415141a')
    expect(extractDoi('10.1016/j.cell.2020.04.026')).toBe('10.1016/j.cell.2020.04.026')
    expect(extractDoi('not a doi')).toBeNull()
  })
})

describe('mapWork', () => {
  it('maps a live-shaped OpenAlex work onto our record', () => {
    const record = mapWork(GAVIN_2002, 'pubmed:11805826')
    expect(record).toMatchObject({
      publicationKey: 'pubmed:11805826',
      provider: 'openalex',
      openalexId: 'W2084619201',
      pmid: '11805826',
      doi: '10.1038/415141a',
      venue: 'Nature',
      year: 2002,
      citationCount: 4799,
      isOpenAccess: true,
      workType: 'article',
      firstAuthor: 'Anne-Claude Gavin',
      authorCount: 2,
    })
  })

  it('deduplicates institutions and strips the ror.org prefix', () => {
    const record = mapWork(GAVIN_2002, 'pubmed:11805826')
    // Two authorships reference CNRS; it must count once, or the independence term
    // would reward large author lists rather than independent labs.
    expect(record.institutionRors).toEqual(['008pyjt05', '02feahw73'])
    expect(record.institutionNames).toHaveLength(2)
  })

  it('tolerates a work with no authorships or location', () => {
    const record = mapWork({ id: 'https://openalex.org/W1' }, 'doi:10.1/x')
    expect(record.authorCount).toBe(0)
    expect(record.venue).toBeNull()
    expect(record.institutionRors).toEqual([])
    // Unknown must stay unknown rather than becoming zero citations.
    expect(record.citationCount).toBeNull()
  })
})

describe('batched', () => {
  it('splits into full batches plus a remainder', () => {
    expect(batched([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(batched([], 10)).toEqual([])
  })
})

function jsonFetch(handler: (url: URL) => unknown, status = 200) {
  const calls: URL[] = []
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    calls.push(url)
    return new Response(JSON.stringify(handler(url)), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('OpenAlexClient', () => {
  it('queries by pmid and returns only the ids that were asked for', async () => {
    const { impl, calls } = jsonFetch(() => ({
      results: [
        GAVIN_2002,
        // An unrelated work the filter happened to return must be ignored.
        { id: 'https://openalex.org/W9', ids: { pmid: 'https://pubmed.ncbi.nlm.nih.gov/999' } },
      ],
    }))
    const client = new OpenAlexClient({ fetchImpl: impl })
    const records = await client.byPmid(['11805826'])

    expect(records).toHaveLength(1)
    expect(records[0]!.publicationKey).toBe('pubmed:11805826')
    expect(calls[0]!.searchParams.get('filter')).toBe('pmid:11805826')
  })

  it('queries by doi, keying the result by the DOI', async () => {
    const { impl, calls } = jsonFetch(() => ({ results: [GAVIN_2002] }))
    const client = new OpenAlexClient({ fetchImpl: impl })
    const records = await client.byDoi(['10.1038/415141a'])

    expect(records[0]!.publicationKey).toBe('doi:10.1038/415141a')
    expect(calls[0]!.searchParams.get('filter')).toBe('doi:10.1038/415141a')
  })

  it('pipe-joins a batch into one request', async () => {
    const { impl, calls } = jsonFetch(() => ({ results: [] }))
    const client = new OpenAlexClient({ fetchImpl: impl })
    await client.byPmid(['1', '2', '3'])
    expect(calls[0]!.searchParams.get('filter')).toBe('pmid:1|2|3')
    expect(calls).toHaveLength(1)
  })

  it('requests only the fields it needs', async () => {
    const { impl, calls } = jsonFetch(() => ({ results: [] }))
    await new OpenAlexClient({ fetchImpl: impl }).byPmid(['1'])
    const select = calls[0]!.searchParams.get('select') ?? ''
    expect(select).toContain('cited_by_count')
    expect(select).toContain('authorships')
    // Abstracts and references are huge and unused.
    expect(select).not.toContain('abstract')
    expect(select).not.toContain('referenced_works')
  })

  it('sends no mailto unless a contact address was configured', async () => {
    const { impl, calls } = jsonFetch(() => ({ results: [] }))
    await new OpenAlexClient({ fetchImpl: impl, contactEmail: null }).byPmid(['1'])
    expect(calls[0]!.searchParams.has('mailto')).toBe(false)

    const second = jsonFetch(() => ({ results: [] }))
    await new OpenAlexClient({
      fetchImpl: second.impl,
      contactEmail: 'someone@example.org',
    }).byPmid(['1'])
    expect(second.calls[0]!.searchParams.get('mailto')).toBe('someone@example.org')
  })

  it('retries a rate-limited request and then succeeds', async () => {
    let attempts = 0
    const impl = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) return new Response('', { status: 429 })
      return new Response(JSON.stringify({ results: [GAVIN_2002] }), { status: 200 })
    }) as unknown as typeof fetch

    const client = new OpenAlexClient({ fetchImpl: impl, sleep: async () => undefined })
    const records = await client.byPmid(['11805826'])
    expect(attempts).toBe(3)
    expect(records).toHaveLength(1)
  })

  it('gives up after the retry budget rather than looping forever', async () => {
    const impl = vi.fn(
      async () => new Response('', { status: 503 }),
    ) as unknown as typeof fetch
    const client = new OpenAlexClient({
      fetchImpl: impl,
      maxRetries: 2,
      sleep: async () => undefined,
    })
    await expect(client.byPmid(['1'])).rejects.toThrow(/503/)
    expect(impl).toHaveBeenCalledTimes(3)
  })

  it('does not call out at all for an empty batch', async () => {
    const { impl } = jsonFetch(() => ({ results: [] }))
    expect(await new OpenAlexClient({ fetchImpl: impl }).byPmid([])).toEqual([])
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('parsePubDateYear', () => {
  it('reads the year out of PubMed date strings', () => {
    expect(parsePubDateYear('2003 Dec 12')).toBe(2003)
    expect(parsePubDateYear('1997')).toBe(1997)
    expect(parsePubDateYear('2020 Jan-Feb')).toBe(2020)
  })

  it('returns null for absent or implausible dates', () => {
    expect(parsePubDateYear(undefined)).toBeNull()
    expect(parsePubDateYear('no date')).toBeNull()
  })
})

describe('PubMedClient', () => {
  const ESUMMARY = {
    result: {
      uids: ['14671306'],
      '14671306': {
        uid: '14671306',
        title: 'Mono- versus polyubiquitination',
        source: 'Science',
        fulljournalname: 'Science (New York, N.Y.)',
        pubdate: '2003 Dec 12',
        sortfirstauthor: 'Li M',
        authors: [{ name: 'Li M' }, { name: 'Brooks CL' }],
        articleids: [
          { idtype: 'pubmed', value: '14671306' },
          { idtype: 'doi', value: '10.1126/science.1091362' },
        ],
      },
    },
  }

  it('maps an esummary record, leaving citations unknown', async () => {
    const { impl } = jsonFetch(() => ESUMMARY)
    const records = await new PubMedClient({ fetchImpl: impl }).byPmid(['14671306'])

    expect(records[0]).toMatchObject({
      publicationKey: 'pubmed:14671306',
      provider: 'pubmed',
      venue: 'Science (New York, N.Y.)',
      year: 2003,
      firstAuthor: 'Li M',
      authorCount: 2,
      doi: '10.1126/science.1091362',
    })
    // PubMed reports no citation count, and pmcrefcount is not a fair substitute.
    expect(records[0]!.citationCount).toBeNull()
  })

  it('skips ids NCBI returns as empty shells', async () => {
    const { impl } = jsonFetch(() => ({
      result: { uids: ['999'], '999': { uid: '999' } },
    }))
    expect(await new PubMedClient({ fetchImpl: impl }).byPmid(['999'])).toEqual([])
  })

  it('comma-joins ids, as eutils expects', async () => {
    const { impl, calls } = jsonFetch(() => ({ result: { uids: [] } }))
    await new PubMedClient({ fetchImpl: impl }).byPmid(['1', '2', '3'])
    expect(calls[0]!.searchParams.get('id')).toBe('1,2,3')
    expect(calls[0]!.searchParams.get('db')).toBe('pubmed')
  })
})
