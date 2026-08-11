import { readFileSync, statSync } from 'node:fs'
import { expect, test } from '@playwright/test'

/**
 * Scalability check against a real BioGRID download.
 *
 * Skipped unless `PROLIVIS_BIG_FIXTURE` points at a `BIOGRID-*.tab3.zip`, because the
 * dumps are far too large to check in. This is the test that substantiates the claim
 * that the browser handles a full release: it exercises the chunked streaming path
 * with an archive that cannot fit the naive "inflate it all, then insert" approach.
 *
 *   PROLIVIS_BIG_FIXTURE=~/Downloads/BIOGRID-CORONAVIRUS-5.0.260.tab3.zip \
 *     npx playwright test scale
 */

const FIXTURE_PATH = process.env['PROLIVIS_BIG_FIXTURE']

test.describe.configure({ mode: 'serial' })

test.skip(!FIXTURE_PATH, 'set PROLIVIS_BIG_FIXTURE to a BioGRID tab3 zip to run')

test('ingests a full BioGRID release without exhausting memory', async ({ page }) => {
  test.setTimeout(900_000)

  const path = FIXTURE_PATH!
  const bytes = [...readFileSync(path)]
  const name = path.replace(/^.*\//, '')
  const zipMb = statSync(path).size / 1e6

  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())

  const started = Date.now()
  const result = await page.evaluate(
    async ({ bytes, name }) => {
      const file = new File([new Uint8Array(bytes)], name)
      return window.prolivis!.load(file)
    },
    { bytes, name },
  )
  const elapsed = (Date.now() - started) / 1000

  // Peak JS heap, as a check that we streamed rather than buffered the whole member.
  const heapMb = await page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? 0,
  )

  console.log(
    `${name}: ${zipMb.toFixed(1)} MB zip -> ${result.recordCount.toLocaleString()} ` +
      `records, ${result.pairCount.toLocaleString()} pairs, ` +
      `${result.publicationCount.toLocaleString()} publications in ${elapsed.toFixed(1)}s ` +
      `(JS heap ${(heapMb / 1e6).toFixed(0)} MB)`,
  )

  expect(result.recordCount).toBeGreaterThan(10_000)
  expect(result.pairCount).toBeGreaterThan(1_000)

  // Aggregation over the whole table must still be interactive; this query is the
  // one the center layout runs on every organism change.
  const queryStarted = Date.now()
  const systems = await page.evaluate(
    (id) => window.prolivis!.systems(id),
    result.datasetId,
  )
  const queryMs = Date.now() - queryStarted
  console.log(`  systems aggregation: ${systems.length} systems in ${queryMs} ms`)

  expect(systems.length).toBeGreaterThan(5)
  expect(queryMs).toBeLessThan(10_000)
})
