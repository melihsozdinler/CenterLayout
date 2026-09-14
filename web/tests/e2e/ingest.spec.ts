import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end ingest against real DuckDB-WASM in a real browser.
 *
 * The fixture is a 975-record sample drawn from BIOGRID-CORONAVIRUS-5.0.260, chosen to
 * cover every branch the ingest SQL has: DOI and PubMed publication references, the
 * pipe-joined `High Throughput|Low Throughput` value, genetic as well as physical
 * systems, self-interactions, cross-species pairs, numeric scores and ontology terms.
 */

const FIXTURE = fileURLToPath(
  new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url),
)
const FIXTURE_BYTES = [...readFileSync(FIXTURE)]
const FIXTURE_NAME = 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip'

/** Load the fixture through the public API and return the ingest result. */
async function loadFixture(page: Page, chunkBytes?: number) {
  return page.evaluate(
    async ({ bytes, name, chunkBytes }) => {
      const file = new File([new Uint8Array(bytes)], name)
      const options = chunkBytes === undefined ? {} : { chunkBytes }
      return window.prolivis!.load(file, options)
    },
    { bytes: FIXTURE_BYTES, name: FIXTURE_NAME, chunkBytes },
  )
}

const sql = <T,>(page: Page, query: string) =>
  page.evaluate((q) => window.prolivis!.sql(q), query) as Promise<T[]>

// The database is persisted in OPFS, which is shared across the whole origin, so
// these tests must not run concurrently with each other.
test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // Persistence is the real product behaviour and is left on; each test instead
  // starts from an empty database.
  await page.evaluate(async () => {
    await window.prolivis!.wipe()
  })
})

test('ingests a real BioGRID tab3 archive', async ({ page }) => {
  test.setTimeout(180_000)

  const result = await loadFixture(page)

  expect(result.recordCount).toBe(975)
  expect(result.biogridRelease).toBe('5.0.260')
  expect(result.label).toBe('CORONAVIRUS 5.0.260')
  expect(result.geneCount).toBeGreaterThan(0)
  expect(result.publicationCount).toBe(164)
  // 898 pairs by BioGRID gene id. Keying by gene symbol instead would give 882,
  // because 18 symbols in this fixture map to more than one gene — see the
  // symbol-collision test below.
  expect(result.pairCount).toBe(898)

  const datasets = await page.evaluate(() => window.prolivis!.datasets())
  expect(datasets).toHaveLength(1)
  expect(datasets[0]!.recordCount).toBe(975)
  expect(datasets[0]!.sourceKind).toBe('file')
})

test('derives publication keys for both PubMed and DOI references', async ({ page }) => {
  test.setTimeout(180_000)
  await loadFixture(page)

  const kinds = await sql<{ ref_kind: string; n: number }>(
    page,
    `SELECT ref_kind, count(*)::INTEGER AS n FROM publications GROUP BY ref_kind ORDER BY ref_kind`,
  )
  const byKind = Object.fromEntries(kinds.map((k) => [k.ref_kind, Number(k.n)]))

  // Both must be present: ProLiVis 1.0 assumed PubMed only and would have dropped
  // every DOI-referenced publication.
  expect(byKind['pubmed']).toBeGreaterThan(0)
  expect(byKind['doi']).toBeGreaterThan(0)

  const doi = await sql<{ publication_key: string; ref_id: string }>(
    page,
    `SELECT publication_key, ref_id FROM publications WHERE ref_kind = 'doi' LIMIT 1`,
  )
  expect(doi[0]!.publication_key).toMatch(/^doi:10\./)
  // DOIs are normalized to lower case so the same paper is one node, not two.
  expect(doi[0]!.ref_id).toBe(doi[0]!.ref_id.toLowerCase())

  const unparsed = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM interactions
      WHERE publication_source IS NOT NULL AND publication_key IS NULL`,
  )
  expect(Number(unparsed[0]!.n)).toBe(0)
})

test('parses the pipe-joined throughput field into independent flags', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await loadFixture(page)

  const both = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM interactions
      WHERE throughput_low AND throughput_high`,
  )
  // The fixture deliberately includes 'High Throughput|Low Throughput' records.
  expect(Number(both[0]!.n)).toBeGreaterThan(0)

  const consistent = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM interactions
      WHERE throughput IS NOT NULL AND NOT throughput_low AND NOT throughput_high`,
  )
  expect(Number(consistent[0]!.n)).toBe(0)
})

test('canonicalizes protein pairs so A-B and B-A are one interaction', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await loadFixture(page)

  const misordered = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM interactions WHERE node_lo > node_hi`,
  )
  expect(Number(misordered[0]!.n)).toBe(0)

  const keyed = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM interactions
      WHERE pair_key <> (node_lo::VARCHAR || '~' || node_hi::VARCHAR)`,
  )
  expect(Number(keyed[0]!.n)).toBe(0)

  const selfInteractions = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM interactions WHERE is_self_interaction`,
  )
  expect(Number(selfInteractions[0]!.n)).toBeGreaterThan(0)
})

test('keeps same-named genes from different species apart', async ({ page }) => {
  test.setTimeout(180_000)
  await loadFixture(page)

  // Coronaviruses all name their structural proteins E, M, N and S. Keying nodes by
  // gene symbol would fuse the SARS-CoV-2 nucleocapsid with the SARS-CoV and MERS
  // ones into a single node with a fabricated interaction profile. BioGRID's gene id
  // is the node identity precisely to prevent that.
  const collisions = await sql<{ symbol: string; genes: number; organisms: number }>(
    page,
    `SELECT symbol,
            count(*)::INTEGER                  AS genes,
            count(DISTINCT organism_id)::INTEGER AS organisms
       FROM genes
      WHERE symbol IS NOT NULL
      GROUP BY symbol
     HAVING count(*) > 1
      ORDER BY genes DESC, symbol`,
  )

  expect(collisions.length).toBe(18)
  const n = collisions.find((c) => c.symbol === 'N')
  expect(n).toBeDefined()
  expect(Number(n!.genes)).toBe(3)
  expect(Number(n!.organisms)).toBe(3)

  // Every collision must be resolved by a distinct gene id, never merged.
  const ids = await sql<{ n: number }>(
    page,
    `SELECT count(DISTINCT biogrid_id)::INTEGER AS n FROM genes WHERE symbol = 'N'`,
  )
  expect(Number(ids[0]!.n)).toBe(3)
})

test('extracts author name and publication year from the Author label', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await loadFixture(page)

  const sample = await sql<{ author: string; author_name: string; year: number }>(
    page,
    `SELECT author, author_name, publication_year AS year FROM interactions
      WHERE author IS NOT NULL AND publication_year IS NOT NULL LIMIT 5`,
  )
  expect(sample.length).toBeGreaterThan(0)
  for (const row of sample) {
    expect(row.author).toContain(row.author_name)
    // The year must not be left inside the name; it is a separate axis in the
    // timeline view and in the trust model's recency term.
    expect(row.author_name).not.toMatch(/\(\d{4}\)/)
    expect(Number(row.year)).toBeGreaterThan(1900)
    expect(Number(row.year)).toBeLessThan(2100)
  }
})

test('aggregates evidence per protein pair in the ppi_pairs view', async ({ page }) => {
  test.setTimeout(180_000)
  const result = await loadFixture(page)

  const pairs = await sql<{ n: number }>(
    page,
    `SELECT count(*)::INTEGER AS n FROM ppi_pairs`,
  )
  expect(Number(pairs[0]!.n)).toBe(result.pairCount)

  // Record counts must reconcile: every interaction row belongs to exactly one pair.
  const totals = await sql<{ records: number }>(
    page,
    `SELECT sum(record_count)::INTEGER AS records FROM ppi_pairs`,
  )
  expect(Number(totals[0]!.records)).toBe(result.recordCount)

  const replicated = await sql<{
    publication_count: number
    system_count: number
    record_count: number
  }>(
    page,
    `SELECT publication_count::INTEGER AS publication_count,
            system_count::INTEGER AS system_count,
            record_count::INTEGER AS record_count
       FROM ppi_pairs ORDER BY publication_count DESC LIMIT 1`,
  )
  // The fixture contains pairs supported by more than one publication; these are the
  // rows the trust model's replication term exists to reward.
  expect(Number(replicated[0]!.publication_count)).toBeGreaterThan(1)
  expect(Number(replicated[0]!.record_count)).toBeGreaterThanOrEqual(
    Number(replicated[0]!.publication_count),
  )
})

test('produces the same result whether ingested in one chunk or many', async ({
  page,
}) => {
  test.setTimeout(240_000)

  // 32 KB forces roughly twenty chunks over a ~560 KB member, exercising the
  // line-alignment and header-reprepending logic that a single-chunk load skips.
  const chunked = await loadFixture(page, 32 * 1024)
  const chunkedPairs = await sql<{ k: string }>(
    page,
    `SELECT pair_key AS k FROM ppi_pairs ORDER BY pair_key`,
  )

  await page.evaluate(async () => {
    await window.prolivis!.wipe()
  })

  const single = await loadFixture(page)
  const singlePairs = await sql<{ k: string }>(
    page,
    `SELECT pair_key AS k FROM ppi_pairs ORDER BY pair_key`,
  )

  expect(chunked.recordCount).toBe(single.recordCount)
  expect(chunked.pairCount).toBe(single.pairCount)
  expect(chunkedPairs.map((r) => r.k)).toEqual(singlePairs.map((r) => r.k))
})

test('lists organisms and experimental systems for the loaded dataset', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const { datasetId } = await loadFixture(page)

  const organisms = await page.evaluate(
    (id) => window.prolivis!.organisms(id),
    datasetId,
  )
  expect(organisms.length).toBeGreaterThan(1)
  // SARS-CoV-2 (2697049) dominates the coronavirus set.
  expect(organisms.map((o) => o.organismId)).toContain(2697049)

  const systems = await page.evaluate(
    (id) => window.prolivis!.systems(id),
    datasetId,
  )
  expect(systems.length).toBeGreaterThan(1)
  expect(systems.map((s) => s.name)).toContain('Two-hybrid')
  // Sorted by publication count: this ordering drives the center layout's sectors.
  for (let i = 1; i < systems.length; i += 1) {
    expect(systems[i - 1]!.publicationCount).toBeGreaterThanOrEqual(
      systems[i]!.publicationCount,
    )
  }
})

test('unloading a dataset removes every derived row', async ({ page }) => {
  test.setTimeout(180_000)
  const { datasetId } = await loadFixture(page)
  await page.evaluate((id) => window.prolivis!.unload(id), datasetId)

  const counts = await sql<{ i: number; g: number; p: number; d: number }>(
    page,
    `SELECT (SELECT count(*) FROM interactions)::INTEGER AS i,
            (SELECT count(*) FROM genes)::INTEGER        AS g,
            (SELECT count(*) FROM publications)::INTEGER AS p,
            (SELECT count(*) FROM datasets)::INTEGER     AS d`,
  )
  expect(counts[0]).toEqual({ i: 0, g: 0, p: 0, d: 0 })
})

test('rejects a non-tab3 file with an actionable message', async ({ page }) => {
  test.setTimeout(120_000)

  const message = await page.evaluate(async () => {
    const bad = new File(['not\ta\tbiogrid\tfile\n1\t2\t3\t4\n'], 'notes.txt')
    try {
      await window.prolivis!.load(bad)
      return null
    } catch (e) {
      return (e as Error).message
    }
  })

  expect(message).toContain('tab3')
})
