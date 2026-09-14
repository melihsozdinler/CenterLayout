import { expect, test } from '@playwright/test'

/**
 * Live verification against the real BioGRID REST service.
 *
 * Skipped unless `PROLIVIS_ACCESS_KEY` is set, because the key belongs to whoever runs
 * the suite. It is never written to disk by these tests and must never be committed:
 *
 *   PROLIVIS_ACCESS_KEY=<your 32-char key> npx playwright test live
 *
 * Register for a free key at https://webservice.thebiogrid.org. The assertions here
 * are deliberately shape-based rather than exact-count, since BioGRID grows monthly.
 */

const ACCESS_KEY = process.env['PROLIVIS_ACCESS_KEY']

test.describe.configure({ mode: 'serial' })

test.skip(!ACCESS_KEY, 'set PROLIVIS_ACCESS_KEY to run live BioGRID tests')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await window.prolivis!.wipe()
    window.prolivis!.disconnect()
  })
})

test('connects to the live service and reports its release', async ({ page }) => {
  test.setTimeout(120_000)
  const release = await page.evaluate((k) => window.prolivis!.connect(k), ACCESS_KEY!)
  console.log(`  live BioGRID REST release: ${release}`)
  expect(release).toMatch(/^\d+\.\d+\.\d+$/)
})

test('fetches a real query and derives every column correctly', async ({ page }) => {
  test.setTimeout(300_000)
  await page.evaluate((k) => window.prolivis!.connect(k), ACCESS_KEY!)

  // MDM2 in human: a small, stable, heavily replicated neighbourhood.
  const result = await page.evaluate(() =>
    window.prolivis!.fetchRemote({
      geneList: ['MDM2'],
      searchNames: true,
      taxId: [9606],
      includeInteractors: true,
      maxRecords: 2000,
    }),
  )

  console.log(
    `  live query: ${result.recordCount} records, release ${result.biogridRelease}`,
  )
  expect(result.recordCount).toBeGreaterThan(100)
  expect(result.biogridRelease).toMatch(/^\d+\.\d+\.\d+$/)

  // Every derived column must be populated from the live tab2 response. A silent
  // failure here — a renamed column resolving to NULL — is exactly what this test
  // exists to catch, and it cannot be caught by a mock.
  const health = await page.evaluate(() =>
    window.prolivis!.sql<Record<string, number>>(`
      SELECT
        count(*)::INTEGER                                              AS total,
        count(*) FILTER (WHERE pair_key IS NULL)::INTEGER              AS null_pair,
        count(*) FILTER (WHERE publication_key IS NULL)::INTEGER       AS null_pub,
        count(*) FILTER (WHERE author_name IS NULL)::INTEGER           AS null_author,
        count(*) FILTER (WHERE publication_year IS NULL)::INTEGER      AS null_year,
        count(*) FILTER (WHERE experimental_system IS NULL)::INTEGER   AS null_system,
        count(*) FILTER (WHERE symbol_a IS NULL OR symbol_b IS NULL)::INTEGER AS null_symbol,
        count(*) FILTER (WHERE organism_id_a IS NULL)::INTEGER         AS null_organism,
        count(*) FILTER (WHERE NOT throughput_low AND NOT throughput_high)::INTEGER
                                                                       AS null_throughput
      FROM interactions`),
  )
  const h = health[0]!
  console.log(`  column health: ${JSON.stringify(h)}`)

  expect(Number(h['null_pair'])).toBe(0)
  expect(Number(h['null_pub'])).toBe(0)
  expect(Number(h['null_author'])).toBe(0)
  expect(Number(h['null_system'])).toBe(0)
  expect(Number(h['null_symbol'])).toBe(0)
  expect(Number(h['null_organism'])).toBe(0)
  expect(Number(h['null_throughput'])).toBe(0)
  // A handful of BioGRID author labels genuinely lack a year; allow a small tail.
  expect(Number(h['null_year'])).toBeLessThan(Number(h['total']) * 0.05)

  // The evidence aggregation the trust model consumes must be non-degenerate: MDM2
  // has interactions supported by several independent publications.
  const best = await page.evaluate(() =>
    window.prolivis!.sql<Record<string, unknown>>(`
      SELECT symbol_lo, symbol_hi,
             publication_count::INTEGER AS publication_count,
             system_count::INTEGER      AS system_count
        FROM ppi_pairs
       ORDER BY publication_count DESC
       LIMIT 3`),
  )
  console.log(`  best supported pairs: ${JSON.stringify(best)}`)
  expect(Number(best[0]!['publication_count'])).toBeGreaterThan(2)
  expect(Number(best[0]!['system_count'])).toBeGreaterThan(1)
})

test('lists live organisms and evidence vocabularies', async ({ page }) => {
  test.setTimeout(180_000)
  await page.evaluate((k) => window.prolivis!.connect(k), ACCESS_KEY!)

  const organisms = await page.evaluate(async () => [
    ...(await window.prolivis!.remoteOrganisms()).entries(),
  ])
  expect(organisms.length).toBeGreaterThan(50)
  expect(organisms.find(([id]) => id === 9606)?.[1]).toContain('Homo sapiens')

  const evidence = await page.evaluate(() => window.prolivis!.remoteEvidenceTypes())
  console.log(`  live evidence vocabulary: ${evidence.length} systems`)
  expect(evidence.length).toBeGreaterThan(20)
})

test('the live evidence vocabulary is fully covered by our classification', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.evaluate((k) => window.prolivis!.connect(k), ACCESS_KEY!)

  const evidence = await page.evaluate(() => window.prolivis!.remoteEvidenceTypes())
  const unknown = await page.evaluate(
    (names) => window.prolivis!.unclassifiedSystems(names),
    evidence,
  )

  // An unclassified assay silently gets a default prior in the trust model. That is a
  // safe fallback, but we want to know when BioGRID adds one so it can be weighted.
  if (unknown.length > 0) {
    console.log(`  UNCLASSIFIED experimental systems: ${unknown.join(', ')}`)
  }
  expect(unknown).toEqual([])
})

/**
 * Live OpenAlex verification. Needs no credentials — OpenAlex is open and CORS-enabled
 * — but is gated so CI never depends on a third-party service:
 *
 *   PROLIVIS_LIVE=1 npx playwright test live
 */
test.describe('live OpenAlex', () => {
  test.skip(!process.env['PROLIVIS_LIVE'], 'set PROLIVIS_LIVE=1 to run')

  test('resolves real BioGRID publications against the real OpenAlex', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const bytes = [
      ...readFileSync(
        fileURLToPath(new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url)),
      ),
    ]

    await page.evaluate(async () => {
      await window.prolivis!.wipe()
      await window.prolivis!.sql('DELETE FROM literature')
    })
    const dataset = await page.evaluate(
      async (b) =>
        window.prolivis!.load(
          new File([new Uint8Array(b)], 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip'),
        ),
      bytes,
    )

    const result = await page.evaluate(() => window.prolivis!.enrich())
    const coverage = await page.evaluate(
      (id) => window.prolivis!.coverage(id),
      dataset.datasetId,
    )
    console.log(
      `  live enrichment: ${result.fromOpenAlex} via OpenAlex, ` +
        `${result.fromPubMed} via PubMed, ${result.notFound} unresolved ` +
        `(of ${result.requested})`,
    )
    console.log(`  coverage: ${JSON.stringify(coverage)}`)

    // Real coverage of a modern BioGRID release should be high; anything much below
    // this means our identifier handling has drifted.
    expect(coverage.enriched / coverage.publications).toBeGreaterThan(0.9)
    expect(coverage.withCitations).toBeGreaterThan(0)
    expect(coverage.withInstitutions).toBeGreaterThan(0)

    const top = await page.evaluate(() =>
      window.prolivis!.sql<Record<string, unknown>>(`
        SELECT title, venue, year, citation_count::INTEGER AS citation_count
          FROM literature
         WHERE found AND citation_count IS NOT NULL
         ORDER BY citation_count DESC
         LIMIT 3`),
    )
    console.log(`  most-cited supporting papers: ${JSON.stringify(top)}`)
    expect(Number(top[0]!['citation_count'])).toBeGreaterThan(10)
  })
})
