import { describe, expect, it, vi } from 'vitest'
import {
  BioGridApiError,
  BioGridRestClient,
  buildInteractionParams,
  describeQuery,
  isWellFormedAccessKey,
  MAX_PAGE_SIZE,
} from '@/data/biogrid-rest'

const KEY = 'a'.repeat(32)

/** Minimal tab2 header, matching what the REST service emits. */
const TAB2_HEADER = [
  '#BioGRID Interaction ID',
  'Entrez Gene Interactor A',
  'Entrez Gene Interactor B',
  'BioGRID ID Interactor A',
  'BioGRID ID Interactor B',
  'Systematic Name Interactor A',
  'Systematic Name Interactor B',
  'Official Symbol Interactor A',
  'Official Symbol Interactor B',
  'Synonyms Interactor A',
  'Synonyms Interactor B',
  'Experimental System Name',
  'Experimental System Type',
  'First Author Surname',
  'Pubmed ID',
  'Organism Interactor A',
  'Organism Interactor B',
  'Interaction Throughput',
  'Quantitative Score',
  'Post Translational Modification',
  'Phenotypes',
  'Qualifications',
  'Tags',
  'Source Database',
].join('\t')

function tab2Page(count: number, firstId = 1): string {
  const rows = Array.from({ length: count }, (_, i) => {
    const id = firstId + i
    return [
      String(id),
      '4193',
      '7157',
      '108276',
      '112315',
      '-',
      '-',
      'MDM2',
      `TP53_${id}`,
      '-',
      '-',
      'Two-hybrid',
      'physical',
      'Smith A (2001)',
      '11805826',
      '9606',
      '9606',
      'Low Throughput',
      '-',
      '-',
      '-',
      '-',
      '-',
      'BIOGRID',
    ].join('\t')
  })
  return [TAB2_HEADER, ...rows].join('\n')
}

/** A fetch stub that records the URLs it was called with. */
function stubFetch(handler: (url: URL) => { body: string; status?: number }) {
  const calls: URL[] = []
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    calls.push(url)
    const { body, status = 200 } = handler(url)
    return new Response(body, { status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('isWellFormedAccessKey', () => {
  it('accepts a 32-character alphanumeric key', () => {
    expect(isWellFormedAccessKey(KEY)).toBe(true)
    expect(isWellFormedAccessKey(` ${KEY} `)).toBe(true)
  })

  it('rejects keys of the wrong shape before a request is wasted on them', () => {
    expect(isWellFormedAccessKey('too-short')).toBe(false)
    expect(isWellFormedAccessKey('!'.repeat(32))).toBe(false)
    expect(isWellFormedAccessKey('')).toBe(false)
  })
})

describe('buildInteractionParams', () => {
  it('requests tab2 with a header so columns can be resolved by name', () => {
    const p = buildInteractionParams({}, KEY, 0, 100)
    expect(p.get('format')).toBe('tab2')
    expect(p.get('includeHeader')).toBe('true')
    expect(p.get('accessKey')).toBe(KEY)
  })

  it('pipe-joins list parameters, as the service requires', () => {
    const p = buildInteractionParams(
      { geneList: ['MDM2', 'TP53'], taxId: [9606, 10090], evidenceList: ['Two-hybrid'] },
      KEY,
      0,
      100,
    )
    expect(p.get('geneList')).toBe('MDM2|TP53')
    expect(p.get('taxId')).toBe('9606|10090')
    expect(p.get('evidenceList')).toBe('Two-hybrid')
  })

  it('omits unset filters rather than sending defaults that override the service', () => {
    const p = buildInteractionParams({}, KEY, 0, 100)
    expect(p.has('geneList')).toBe(false)
    expect(p.has('taxId')).toBe(false)
    expect(p.has('throughputTag')).toBe(false)
    expect(p.has('includeInteractors')).toBe(false)
  })

  it('serializes booleans explicitly, including false', () => {
    const p = buildInteractionParams(
      { includeInteractors: false, interSpeciesExcluded: true },
      KEY,
      0,
      100,
    )
    expect(p.get('includeInteractors')).toBe('false')
    expect(p.get('interSpeciesExcluded')).toBe('true')
  })

  it('carries pagination through', () => {
    const p = buildInteractionParams({}, KEY, 250, 50)
    expect(p.get('start')).toBe('250')
    expect(p.get('max')).toBe('50')
  })
})

describe('describeQuery', () => {
  it('renders a query as provenance a reader can act on', () => {
    expect(
      describeQuery({ geneList: ['MDM2'], taxId: [9606], throughputTag: 'low' }),
    ).toBe('genes=MDM2 taxId=9606 throughput=low')
  })

  it('distinguishes including from excluding evidence', () => {
    expect(describeQuery({ evidenceList: ['Two-hybrid'], includeEvidence: false })).toBe(
      'excluding=Two-hybrid',
    )
    expect(describeQuery({ evidenceList: ['Two-hybrid'], includeEvidence: true })).toBe(
      'evidence=Two-hybrid',
    )
  })

  it('describes an unfiltered query', () => {
    expect(describeQuery({})).toBe('all interactions')
  })
})

describe('BioGridRestClient error handling', () => {
  it('surfaces the service error message for a malformed key', async () => {
    const { impl } = stubFetch(() => ({
      body: JSON.stringify({
        STATUS: 'ERROR',
        MESSAGES: ['Your Access Key is Not Validly Formatted.'],
        TYPE: 'UNAUTHORIZED ACCESS',
      }),
      status: 200,
    }))
    const client = new BioGridRestClient({ accessKey: 'bad', fetchImpl: impl })

    await expect(client.version()).rejects.toThrow(BioGridApiError)
    await expect(client.version()).rejects.toThrow(/Access Key/)
  })

  it('reports the error type so the UI can distinguish auth from other failures', async () => {
    const { impl } = stubFetch(() => ({
      body: JSON.stringify({ STATUS: 'ERROR', MESSAGES: ['nope'], TYPE: 'UNAUTHORIZED ACCESS' }),
    }))
    const client = new BioGridRestClient({ accessKey: 'bad', fetchImpl: impl })
    await client.version().then(
      () => expect.unreachable('should have thrown'),
      (e: BioGridApiError) => expect(e.type).toBe('UNAUTHORIZED ACCESS'),
    )
  })

  it('explains a network failure as connectivity, not as a BioGRID fault', async () => {
    const impl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })
    await expect(client.version()).rejects.toThrow(/offline mode/)
  })
})

describe('BioGridRestClient metadata endpoints', () => {
  it('parses the organism list into taxid -> name', async () => {
    const { impl } = stubFetch(() => ({
      body: '9606\tHomo sapiens\n10090\tMus musculus\n559292\tSaccharomyces cerevisiae (S288c)\n',
    }))
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })
    const organisms = await client.organisms()
    expect(organisms.get(9606)).toBe('Homo sapiens')
    expect(organisms.get(559292)).toBe('Saccharomyces cerevisiae (S288c)')
    expect(organisms.size).toBe(3)
  })

  it('parses a count response', async () => {
    const { impl } = stubFetch(() => ({ body: '4211\n' }))
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })
    expect(await client.count({ geneList: ['MDM2'] })).toBe(4211)
  })

  it('asks for format=count without a header when counting', async () => {
    const { impl, calls } = stubFetch(() => ({ body: '7' }))
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })
    await client.count({})
    expect(calls[0]!.searchParams.get('format')).toBe('count')
    expect(calls[0]!.searchParams.has('includeHeader')).toBe(false)
  })
})

describe('BioGridRestClient pagination', () => {
  it('stops when a page comes back shorter than the page size', async () => {
    const { impl, calls } = stubFetch((url) => {
      const start = Number(url.searchParams.get('start'))
      // 15,000 records over a 10,000 page size: full page, then a partial one.
      return { body: tab2Page(start === 0 ? MAX_PAGE_SIZE : 5000, start + 1) }
    })
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })

    let total = 0
    let pages = 0
    for await (const page of client.pages({})) {
      pages += 1
      total = page.recordsSoFar
    }

    expect(pages).toBe(2)
    expect(total).toBe(15_000)
    expect(calls.map((c) => c.searchParams.get('start'))).toEqual(['0', '10000'])
  })

  it('stops immediately on a header-only page', async () => {
    const { impl } = stubFetch(() => ({ body: `${TAB2_HEADER}\n` }))
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })

    const pages = []
    for await (const page of client.pages({})) pages.push(page)
    expect(pages).toEqual([])
  })

  it('honours maxRecords instead of draining the whole result set', async () => {
    const { impl, calls } = stubFetch((url) => ({
      body: tab2Page(Number(url.searchParams.get('max'))),
    }))
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })

    let total = 0
    for await (const page of client.pages({ maxRecords: 250 })) total = page.recordsSoFar

    expect(total).toBe(250)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('max')).toBe('250')
  })

  it('never requests more than the service will return in one page', async () => {
    const { impl, calls } = stubFetch(() => ({ body: tab2Page(10) }))
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })
    for await (const _ of client.pages({ maxRecords: 999_999 })) break
    expect(Number(calls[0]!.searchParams.get('max'))).toBeLessThanOrEqual(MAX_PAGE_SIZE)
  })

  it('aborts mid-stream when signalled', async () => {
    const controller = new AbortController()
    const { impl } = stubFetch(() => ({ body: tab2Page(MAX_PAGE_SIZE) }))
    const client = new BioGridRestClient({ accessKey: KEY, fetchImpl: impl })

    await expect(
      (async () => {
        for await (const _ of client.pages({}, { signal: controller.signal })) {
          controller.abort()
        }
      })(),
    ).rejects.toThrow(/Aborted/)
  })
})
