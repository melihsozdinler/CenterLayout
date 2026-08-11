import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Literature enrichment end-to-end, with OpenAlex and PubMed intercepted.
 *
 * Uses the real BioGRID fixture, so the publication keys under test are the genuine
 * mix of PubMed- and DOI-referenced records that a modern release contains.
 */

const FIXTURE = fileURLToPath(
  new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url),
)
const FIXTURE_BYTES = [...readFileSync(FIXTURE)]

const sql = <T,>(page: Page, query: string) =>
  page.evaluate((q) => window.prolivis!.sql(q), query) as Promise<T[]>

async function loadFixture(page: Page) {
  return page.evaluate(async (bytes) => {
    const file = new File(
      [new Uint8Array(bytes)],
      'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
    )
    return window.prolivis!.load(file)
  }, FIXTURE_BYTES)
}

interface MockOptions {
  /** Publication keys OpenAlex should claim not to know. */
  readonly openAlexMisses?: string[]
  /** Publication keys PubMed should also fail on. */
  readonly pubMedMisses?: string[]
  readonly openAlexStatus?: number
}

async function mockProviders(page: Page, options: MockOptions = {}) {
  const openAlexMisses = new Set(options.openAlexMisses ?? [])
  const pubMedMisses = new Set(options.pubMedMisses ?? [])
  const counters = { openalex: 0, pubmed: 0 }
  await page.exposeFunction('__countCall', (which: 'openalex' | 'pubmed') => {
    counters[which] += 1
  })

  await page.route('https://api.openalex.org/**', async (route) => {
    if (options.openAlexStatus && options.openAlexStatus !== 200) {
      return route.fulfill({ status: options.openAlexStatus, body: '' })
    }
    const url = new URL(route.request().url())
    const filter = url.searchParams.get('filter') ?? ''
    const [kind, joined] = filter.split(':')
    const ids = (joined ?? '').split('|').filter(Boolean)

    const results = ids
      .filter((id) => !openAlexMisses.has(`${kind === 'pmid' ? 'pubmed' : 'doi'}:${id}`))
      .map((id, i) => ({
        id: `https://openalex.org/W${1000 + i}`,
        doi: kind === 'doi' ? `https://doi.org/${id}` : `https://doi.org/10.9999/x${i}`,
        ids: {
          ...(kind === 'pmid'
            ? { pmid: `https://pubmed.ncbi.nlm.nih.gov/${id}` }
            : {}),
          doi: kind === 'doi' ? `https://doi.org/${id}` : `https://doi.org/10.9999/x${i}`,
        },
        display_name: `Work ${id}`,
        publication_year: 2015,
        cited_by_count: 100 + i,
        type: 'article',
        primary_location: { source: { display_name: 'Journal of Testing' } },
        open_access: { is_oa: i % 2 === 0 },
        authorships: [
          {
            author: { display_name: 'Someone A' },
            institutions: [
              { ror: `https://ror.org/lab${i % 3}`, display_name: `Lab ${i % 3}` },
            ],
          },
        ],
      }))

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results, meta: { count: results.length } }),
    })
  })

  await page.route('https://eutils.ncbi.nlm.nih.gov/**', async (route) => {
    const url = new URL(route.request().url())
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean)
    const kept = ids.filter((id) => !pubMedMisses.has(`pubmed:${id}`))
    const result: Record<string, unknown> = { uids: kept }
    for (const id of kept) {
      result[id] = {
        uid: id,
        title: `PubMed fallback ${id}`,
        source: 'Fallback Journal',
        fulljournalname: 'Fallback Journal',
        pubdate: '1998 May 1',
        sortfirstauthor: 'Fallback F',
        authors: [{ name: 'Fallback F' }],
        articleids: [{ idtype: 'pubmed', value: id }],
      }
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result }),
    })
  })

  return counters
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await window.prolivis!.wipe()
    await window.prolivis!.sql('DELETE FROM literature')
  })
})

test('enriches every resolvable publication and reports coverage', async ({ page }) => {
  test.setTimeout(240_000)
  await mockProviders(page)
  const dataset = await loadFixture(page)

  const result = await page.evaluate(() => window.prolivis!.enrich())

  expect(result.requested).toBe(dataset.publicationCount)
  expect(result.fromOpenAlex).toBe(dataset.publicationCount)
  expect(result.notFound).toBe(0)
  expect(result.failedBatches).toBe(0)

  const coverage = await page.evaluate(
    (id) => window.prolivis!.coverage(id),
    dataset.datasetId,
  )
  expect(coverage.publications).toBe(dataset.publicationCount)
  expect(coverage.enriched).toBe(dataset.publicationCount)
  expect(coverage.withCitations).toBe(dataset.publicationCount)
  expect(coverage.withInstitutions).toBe(dataset.publicationCount)
})

test('enriches both PubMed- and DOI-referenced publications', async ({ page }) => {
  test.setTimeout(240_000)
  await mockProviders(page)
  await loadFixture(page)
  await page.evaluate(() => window.prolivis!.enrich())

  const byKind = await sql<{ ref_kind: string; enriched: number }>(
    page,
    `SELECT p.ref_kind, count(*) FILTER (WHERE l.found)::INTEGER AS enriched
       FROM publications p JOIN literature l USING (publication_key)
      GROUP BY p.ref_kind ORDER BY p.ref_kind`,
  )
  const kinds = Object.fromEntries(byKind.map((r) => [r.ref_kind, Number(r.enriched)]))
  expect(kinds['doi']).toBeGreaterThan(0)
  expect(kinds['pubmed']).toBeGreaterThan(0)
})

test('falls back to PubMed for ids OpenAlex does not know', async ({ page }) => {
  test.setTimeout(240_000)
  await loadFixture(page)

  // Pick two real PubMed-referenced publications and hide them from OpenAlex.
  const hidden = await sql<{ publication_key: string }>(
    page,
    `SELECT publication_key FROM publications WHERE ref_kind = 'pubmed'
      ORDER BY publication_key LIMIT 2`,
  )
  const keys = hidden.map((h) => h.publication_key)
  await mockProviders(page, { openAlexMisses: keys })

  const result = await page.evaluate(() => window.prolivis!.enrich())
  expect(result.fromPubMed).toBe(2)
  expect(result.notFound).toBe(0)

  const rows = await sql<{ provider: string; citation_count: number | null }>(
    page,
    `SELECT provider, citation_count FROM literature
      WHERE publication_key IN (${keys.map((k) => `'${k}'`).join(',')})`,
  )
  expect(rows.every((r) => r.provider === 'pubmed')).toBe(true)
  // Unknown impact must stay unknown; scoring it as zero would penalise the paper
  // for our inability to resolve it.
  expect(rows.every((r) => r.citation_count === null)).toBe(true)
})

test('records unresolvable publications so they are not re-fetched', async ({ page }) => {
  test.setTimeout(240_000)
  await loadFixture(page)

  const hidden = await sql<{ publication_key: string }>(
    page,
    `SELECT publication_key FROM publications WHERE ref_kind = 'pubmed'
      ORDER BY publication_key LIMIT 3`,
  )
  const keys = hidden.map((h) => h.publication_key)
  await mockProviders(page, { openAlexMisses: keys, pubMedMisses: keys })

  const first = await page.evaluate(() => window.prolivis!.enrich())
  expect(first.notFound).toBe(3)

  const notFound = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM literature WHERE found = FALSE`,
  )
  expect(Number(notFound[0]!.n)).toBe(3)

  // A second pass must find nothing left to do.
  const second = await page.evaluate(() => window.prolivis!.enrich())
  expect(second.requested).toBe(0)
})

test('the cache is shared across datasets, so a reload costs nothing', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await mockProviders(page)
  await loadFixture(page)
  const first = await page.evaluate(() => window.prolivis!.enrich())
  expect(first.requested).toBeGreaterThan(0)

  // Load the very same data again as a second, independent dataset.
  const second = await loadFixture(page)
  const datasets = await page.evaluate(() => window.prolivis!.datasets())
  expect(datasets).toHaveLength(2)

  const again = await page.evaluate(() => window.prolivis!.enrich())
  expect(again.requested).toBe(0)

  // And the second dataset is fully covered without a single new request.
  const coverage = await page.evaluate(
    (id) => window.prolivis!.coverage(id),
    second.datasetId,
  )
  expect(coverage.enriched).toBe(coverage.publications)
})

test('survives an OpenAlex outage without losing the dataset', async ({ page }) => {
  test.setTimeout(240_000)
  await mockProviders(page, { openAlexStatus: 503, pubMedMisses: [] })
  const dataset = await loadFixture(page)

  const result = await page.evaluate(() => window.prolivis!.enrich())

  // OpenAlex fails for every batch; PubMed still resolves the PubMed-keyed ones.
  expect(result.failedBatches).toBeGreaterThan(0)
  expect(result.fromOpenAlex).toBe(0)
  expect(result.fromPubMed).toBeGreaterThan(0)

  // The interaction data itself is untouched — enrichment is strictly additive.
  const records = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM interactions`,
  )
  expect(Number(records[0]!.n)).toBe(dataset.recordCount)
})

test('respects a limit so a huge dataset can be enriched incrementally', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await mockProviders(page)
  await loadFixture(page)

  const result = await page.evaluate(() => window.prolivis!.enrich({ limit: 20 }))
  expect(result.requested).toBe(20)

  const cached = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM literature`,
  )
  expect(Number(cached[0]!.n)).toBe(20)
})
