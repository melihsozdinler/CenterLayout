import { expect, test, type Page } from '@playwright/test'

/**
 * Online mode end-to-end, with thebiogrid.org intercepted.
 *
 * The point is to prove that a tab2 REST response travels the *same* path as a tab3
 * file: alias-based column resolution, the same DuckDB projection, the same derived
 * columns. A live test would need the user's own access key, so the service is mocked
 * here and the real one is exercised by `npm run test:e2e:live` (see docs).
 */

const KEY = 'b'.repeat(32)

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
  'Experimental System',
  'Experimental System Type',
  'Author',
  'Pubmed ID',
  'Organism Interactor A',
  'Organism Interactor B',
  'Throughput',
  'Score',
  'Modification',
  'Phenotypes',
  'Qualifications',
  'Tags',
  'Source Database',
].join('\t')

interface Row {
  id: number
  symbolA: string
  symbolB: string
  idA: number
  idB: number
  system: string
  author: string
  pubmed: string
  throughput: string
}

function tab2Row(r: Row): string {
  return [
    String(r.id),
    '4193',
    '7157',
    String(r.idA),
    String(r.idB),
    '-',
    '-',
    r.symbolA,
    r.symbolB,
    '-',
    '-',
    r.system,
    'physical',
    r.author,
    r.pubmed,
    '9606',
    '9606',
    r.throughput,
    '-',
    '-',
    '-',
    '-',
    '-',
    'BIOGRID',
  ].join('\t')
}

/** Two publications and two assays supporting one pair, plus a singleton pair. */
const ROWS: Row[] = [
  {
    id: 1,
    idA: 108276,
    idB: 112315,
    symbolA: 'MDM2',
    symbolB: 'TP53',
    system: 'Two-hybrid',
    author: 'Smith A (2001)',
    pubmed: '11805826',
    throughput: 'Low Throughput',
  },
  {
    id: 2,
    idA: 108276,
    idB: 112315,
    symbolA: 'MDM2',
    symbolB: 'TP53',
    system: 'Affinity Capture-Western',
    author: 'Jones B (2010)',
    pubmed: '20351260',
    throughput: 'High Throughput|Low Throughput',
  },
  {
    id: 3,
    idA: 108276,
    idB: 999001,
    symbolA: 'MDM2',
    symbolB: 'RPL5',
    system: 'Affinity Capture-MS',
    author: 'Jones B (2010)',
    pubmed: '20351260',
    throughput: 'High Throughput',
  },
]

async function mockBioGrid(page: Page, options: { rows?: Row[] } = {}) {
  const rows = options.rows ?? ROWS

  await page.route('https://webservice.thebiogrid.org/**', async (route) => {
    const url = new URL(route.request().url())

    if (url.pathname.startsWith('/version')) {
      return route.fulfill({ status: 200, body: '5.0.260' })
    }
    if (url.pathname.startsWith('/organisms')) {
      return route.fulfill({ status: 200, body: '9606\tHomo sapiens\n10090\tMus musculus\n' })
    }
    if (url.pathname.startsWith('/evidence')) {
      return route.fulfill({ status: 200, body: 'Two-hybrid\nAffinity Capture-MS\n' })
    }
    if (url.pathname.startsWith('/interactions')) {
      if (url.searchParams.get('format') === 'count') {
        return route.fulfill({ status: 200, body: String(rows.length) })
      }
      const start = Number(url.searchParams.get('start') ?? '0')
      const max = Number(url.searchParams.get('max') ?? '10000')
      const page = rows.slice(start, start + max)
      const body = [TAB2_HEADER, ...page.map(tab2Row)].join('\n')
      return route.fulfill({ status: 200, body })
    }
    return route.fulfill({ status: 404, body: 'not found' })
  })
}

const sql = <T,>(page: Page, query: string) =>
  page.evaluate((q) => window.prolivis!.sql(q), query) as Promise<T[]>

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await window.prolivis!.wipe()
    window.prolivis!.disconnect()
  })
})

test('connect validates the key against the service and stores it', async ({ page }) => {
  test.setTimeout(120_000)
  await mockBioGrid(page)

  const release = await page.evaluate((k) => window.prolivis!.connect(k), KEY)
  expect(release).toBe('5.0.260')
  expect(await page.evaluate(() => window.prolivis!.isConnected())).toBe(true)

  await page.evaluate(() => window.prolivis!.disconnect())
  expect(await page.evaluate(() => window.prolivis!.isConnected())).toBe(false)
})

test('rejects a badly shaped key without contacting the service', async ({ page }) => {
  test.setTimeout(120_000)
  let requests = 0
  await page.route('https://webservice.thebiogrid.org/**', async (route) => {
    requests += 1
    await route.fulfill({ status: 200, body: '5.0.260' })
  })

  const message = await page.evaluate(async () => {
    try {
      await window.prolivis!.connect('nope')
      return null
    } catch (e) {
      return (e as Error).message
    }
  })

  expect(message).toContain('32-character')
  expect(requests).toBe(0)
})

test('loads a REST query through the same pipeline as a file', async ({ page }) => {
  test.setTimeout(180_000)
  await mockBioGrid(page)
  await page.evaluate((k) => window.prolivis!.connect(k), KEY)

  const result = await page.evaluate(() =>
    window.prolivis!.fetchRemote({ geneList: ['MDM2'], taxId: [9606], searchNames: true }),
  )

  expect(result.recordCount).toBe(3)
  expect(result.biogridRelease).toBe('5.0.260')
  expect(result.label).toContain('genes=MDM2')

  // tab2 carries no accessions, ontology terms or organism names; the result says so
  // rather than leaving the user to discover empty columns later.
  expect(result.absentColumns).toContain('Organism Name Interactor A')
  expect(result.absentColumns).toContain('SWISS-PROT Accessions Interactor A')

  const datasets = await page.evaluate(() => window.prolivis!.datasets())
  expect(datasets).toHaveLength(1)
  expect(datasets[0]!.sourceKind).toBe('rest')
  expect(datasets[0]!.sourceDetail).toContain('taxId=9606')
})

test('derives the same columns from tab2 as from tab3', async ({ page }) => {
  test.setTimeout(180_000)
  await mockBioGrid(page)
  await page.evaluate((k) => window.prolivis!.connect(k), KEY)
  await page.evaluate(() => window.prolivis!.fetchRemote({ geneList: ['MDM2'] }))

  // A bare PubMed id (tab2) must key identically to a `PUBMED:`-prefixed one (tab3).
  const pubs = await sql<{ publication_key: string; ref_kind: string; year: number }>(
    page,
    `SELECT publication_key, ref_kind, year FROM publications ORDER BY publication_key`,
  )
  expect(pubs.map((p) => p.publication_key)).toEqual([
    'pubmed:11805826',
    'pubmed:20351260',
  ])
  expect(pubs.every((p) => p.ref_kind === 'pubmed')).toBe(true)
  expect(Number(pubs[0]!.year)).toBe(2001)

  // Throughput, author name and pair canonicalization all come out of the shared SQL.
  const rows = await sql<{
    author_name: string
    throughput_low: boolean
    throughput_high: boolean
  }>(
    page,
    `SELECT author_name, throughput_low, throughput_high FROM interactions
      WHERE biogrid_interaction_id = 2`,
  )
  expect(rows[0]!.author_name).toBe('Jones B')
  expect(rows[0]!.throughput_low).toBe(true)
  expect(rows[0]!.throughput_high).toBe(true)

  const pairs = await sql<{
    pair_key: string
    publication_count: number
    system_count: number
  }>(
    page,
    `SELECT pair_key, publication_count::INTEGER AS publication_count,
            system_count::INTEGER AS system_count
       FROM ppi_pairs ORDER BY publication_count DESC`,
  )
  expect(pairs).toHaveLength(2)
  // MDM2-TP53 is supported by two publications using two different assays.
  expect(Number(pairs[0]!.publication_count)).toBe(2)
  expect(Number(pairs[0]!.system_count)).toBe(2)
})

test('paginates until the service returns a short page', async ({ page }) => {
  test.setTimeout(240_000)

  // 250 rows with a forced page size of 100 exercises the paging loop.
  const many: Row[] = Array.from({ length: 250 }, (_, i) => ({
    id: 1000 + i,
    idA: 108276,
    idB: 200000 + i,
    symbolA: 'MDM2',
    symbolB: `GENE${i}`,
    system: 'Affinity Capture-MS',
    author: 'Screen C (2015)',
    pubmed: '26000000',
    throughput: 'High Throughput',
  }))
  await mockBioGrid(page, { rows: many })
  await page.evaluate((k) => window.prolivis!.connect(k), KEY)

  const result = await page.evaluate(() =>
    window.prolivis!.fetchRemote({ geneList: ['MDM2'], maxRecords: 250 }),
  )
  expect(result.recordCount).toBe(250)

  const pairs = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM ppi_pairs`,
  )
  expect(Number(pairs[0]!.n)).toBe(250)
})

test('leaves no partial dataset behind when a fetch fails midway', async ({ page }) => {
  test.setTimeout(180_000)
  await mockBioGrid(page)
  await page.evaluate((k) => window.prolivis!.connect(k), KEY)

  // Let /version and /count succeed, then fail the interactions fetch.
  await page.route('**/interactions/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('format') === 'count') {
      return route.fulfill({ status: 200, body: '3' })
    }
    return route.fulfill({
      status: 500,
      body: JSON.stringify({ STATUS: 'ERROR', MESSAGES: ['Service unavailable'] }),
    })
  })

  const message = await page.evaluate(async () => {
    try {
      await window.prolivis!.fetchRemote({ geneList: ['MDM2'] })
      return null
    } catch (e) {
      return (e as Error).message
    }
  })
  expect(message).toContain('Service unavailable')

  const counts = await sql<{ d: number; i: number }>(
    page,
    `SELECT (SELECT count(*) FROM datasets)::INTEGER AS d,
            (SELECT count(*) FROM interactions)::INTEGER AS i`,
  )
  expect(counts[0]).toEqual({ d: 0, i: 0 })
})

test('refuses to query without a stored access key', async ({ page }) => {
  test.setTimeout(120_000)
  const message = await page.evaluate(async () => {
    try {
      await window.prolivis!.fetchRemote({ geneList: ['MDM2'] })
      return null
    } catch (e) {
      return (e as Error).message
    }
  })
  expect(message).toContain('access key')
})
