import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/**
 * The inputs for the view models the interface does not draw.
 *
 * These existed as functions taking assembled inputs that nothing produced, so four
 * documented capabilities could not be used without writing the SQL by hand. These
 * tests are the check that they can be now.
 */
const FIXTURE = {
  name: 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
  mimeType: 'application/zip',
  buffer: readFileSync(
    fileURLToPath(new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url)),
  ),
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())
  await page.reload()
  await page.setInputFiles('input[type="file"]', FIXTURE)
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.prolivis!.datasets()))[0]?.recordCount ?? 0,
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0)
})

test('builds the inputs the undrawn views take', async ({ page }) => {
  test.setTimeout(300_000)

  const result = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const query = { datasetId: ds!.datasetId, physicalOnly: true }

    const systems = await window.prolivis!.pairSystems(query)
    const upset = window.prolivis!.upset(systems, { maxIntersections: 5 })
    const chord = window.prolivis!.methodChord(systems)
    const records = await window.prolivis!.timelineRecords(query)
    const timeline = window.prolivis!.timeline(records)
    const bipartite = window.prolivis!.bipartite(
      await window.prolivis!.bipartiteInput(query, { maxPublications: 8 }),
    )

    const scored = await window.prolivis!.score(query)
    return {
      pairs: systems.length,
      scoredPairs: scored.length,
      everyPairHasASystem: systems.every((s) => s.systems.length > 0),
      upset: upset.intersections.length,
      upsetTotal: upset.intersections.reduce((sum, i) => sum + i.count, 0),
      chord: chord.chords.length,
      records: records.length,
      recordsHaveMethods: records.every((r) => r.system.length > 0),
      years: timeline.years.length,
      bipartite: {
        nodes: bipartite.nodes.length,
        links: bipartite.links.length,
        lanes: bipartite.lanes.length,
      },
    }
  })

  // Every scored interaction is accounted for by a method, since a record without one
  // is not evidence of anything.
  expect(result.pairs).toBe(result.scoredPairs)
  expect(result.everyPairHasASystem).toBe(true)

  expect(result.upset).toBeGreaterThan(0)
  expect(result.upsetTotal).toBeLessThanOrEqual(result.pairs)
  expect(result.chord).toBeGreaterThan(0)

  expect(result.records).toBeGreaterThan(result.pairs)
  expect(result.recordsHaveMethods).toBe(true)
  expect(result.years).toBeGreaterThan(1)

  expect(result.bipartite.nodes).toBeGreaterThan(8)
  expect(result.bipartite.links).toBeGreaterThan(0)
  expect(result.bipartite.lanes).toBeGreaterThan(0)
})

test('answers over the same rows as the trust model', async ({ page }) => {
  test.setTimeout(300_000)

  // A view and a score computed over "this publication only" must be computed over the
  // same interactions, or the two halves of the interface would disagree.
  const check = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const top = await window.prolivis!.topPublications(ds!.datasetId, 1)
    const query = {
      datasetId: ds!.datasetId,
      publications: [top[0]!.publicationKey],
      physicalOnly: true,
    }
    const scored = await window.prolivis!.score(query)
    const systems = await window.prolivis!.pairSystems(query)
    return { scored: scored.length, systems: systems.length }
  })

  expect(check.systems).toBe(check.scored)
  expect(check.scored).toBeGreaterThan(0)
})
