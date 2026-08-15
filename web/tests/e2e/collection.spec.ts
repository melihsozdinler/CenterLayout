import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Gathering several publications into one network, and saving it as a dataset.
 */
const FIXTURE = {
  name: 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
  mimeType: 'application/zip',
  buffer: readFileSync(
    fileURLToPath(new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url)),
  ),
}

const counts = (page: Page) =>
  page
    .getByRole('banner')
    .textContent()
    .then((t) => ({
      proteins: Number((t?.match(/([\d,]+) proteins/)?.[1] ?? '0').replace(/,/g, '')),
      interactions: Number(
        (t?.match(/([\d,]+) interactions/)?.[1] ?? '0').replace(/,/g, ''),
      ),
    }))

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())
  await page.reload()
  await page.setInputFiles('input[type="file"]', FIXTURE)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.literature-results li').first()).toBeVisible({
    timeout: 60_000,
  })
})

/** Tick the first `n` publications in the result list. */
async function collect(page: Page, n: number) {
  for (let i = 0; i < n; i += 1) {
    await page.locator('.literature-results li input[type="checkbox"]').nth(i).check()
  }
  await expect(page.locator('.panel.collection')).toBeVisible()
}

test('gathers publications into a collection', async ({ page }) => {
  test.setTimeout(300_000)
  await collect(page, 3)

  await expect(page.locator('.panel.collection h2')).toContainText('Collection (3)')
  expect(await page.locator('.collected-list li').count()).toBe(3)

  // The collection survives a new search: it is built up across several queries.
  await page.getByPlaceholder(/Author, year, PubMed/).fill('2020')
  await expect
    .poll(() => page.locator('.literature-results li').count(), { timeout: 60_000 })
    .toBeGreaterThan(0)
  expect(await page.locator('.collected-list li').count()).toBe(3)

  await page.getByRole('button', { name: 'clear' }).click()
  await expect(page.locator('.panel.collection')).toBeHidden()
})

test('visualizes the combined network of several publications', async ({ page }) => {
  test.setTimeout(300_000)
  await collect(page, 3)

  const keys = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const top = await window.prolivis!.topPublications(ds!.datasetId, 3)
    return { id: ds!.datasetId, keys: top.map((t) => t.publicationKey) }
  })

  await page.getByRole('button', { name: /Visualize combined network/ }).click()
  await expect(page.locator('.crumb-current')).toContainText('3 publications', {
    timeout: 60_000,
  })

  // The union of three publications, with overlaps counted once.
  const expected = await page.evaluate(
    async ({ id, keys }) =>
      (await window.prolivis!.score({ datasetId: id, publications: keys })).length,
    keys,
  )
  await expect.poll(async () => (await counts(page)).interactions, { timeout: 60_000 })
    .toBe(expected)
})

test('saves a collection as a dataset that outlives the view', async ({ page }) => {
  test.setTimeout(300_000)
  await collect(page, 3)

  const before = (await page.evaluate(() => window.prolivis!.datasets())).length
  await page.getByPlaceholder(/interactome screens/).fill('My reading list')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  const listed = page.locator('.dataset-list li', { hasText: 'My reading list' })
  await expect(listed).toBeVisible({ timeout: 120_000 })
  const datasets = await page.evaluate(() => window.prolivis!.datasets())
  expect(datasets).toHaveLength(before + 1)

  const derived = datasets.find((d) => d.label === 'My reading list')!
  expect(derived.sourceKind).toBe('derived')
  expect(derived.publicationCount).toBe(3)
  // The release is inherited: a derived set is still that release's data, and without
  // it nothing could be compared against it.
  expect(derived.biogridRelease).toBe('5.0.260')
  expect(derived.recordCount).toBeGreaterThan(0)

  // It is a dataset like any other: scorable, and it becomes the active one.
  const scored = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }),
    derived.datasetId,
  )
  expect(scored.length).toBe(derived.pairCount)

  // And it survives a reload, which is the point of saving rather than scoping.
  await page.reload()
  await expect(page.locator('.dataset-list li', { hasText: 'My reading list' })).toBeVisible({
    timeout: 120_000,
  })
})

test('a derived dataset merges overlapping evidence rather than double-counting', async ({
  page,
}) => {
  test.setTimeout(300_000)

  // Two publications chosen because they report interactions in common.
  const overlap = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const top = await window.prolivis!.topPublications(ds!.datasetId, 12)
    for (let i = 0; i < top.length; i += 1) {
      for (let j = i + 1; j < top.length; j += 1) {
        const a = top[i]!.publicationKey
        const b = top[j]!.publicationKey
        const [pa, pb, both] = await Promise.all([
          window.prolivis!.score({ datasetId: ds!.datasetId, publications: [a] }),
          window.prolivis!.score({ datasetId: ds!.datasetId, publications: [b] }),
          window.prolivis!.score({ datasetId: ds!.datasetId, publications: [a, b] }),
        ])
        if (both.length < pa.length + pb.length) {
          return { id: ds!.datasetId, a, b, sum: pa.length + pb.length, union: both.length }
        }
      }
    }
    return null
  })

  test.skip(overlap === null, 'no two publications in the fixture share an interaction')

  const derived = await page.evaluate(
    async ({ id, a, b }) =>
      window.prolivis!.derive({ datasetId: id, publications: [a, b], label: 'Overlap' }),
    overlap!,
  )

  // The union, not the sum: an interaction reported by both papers is one interaction
  // carrying two pieces of evidence, and counting it twice would inflate replication
  // and therefore every trust score computed from it.
  expect(derived.pairCount).toBe(overlap!.union)
  expect(derived.pairCount).toBeLessThan(overlap!.sum)

  const replicated = await page.evaluate(
    (id) =>
      window.prolivis!.sql<{ n: number }>(
        `SELECT count(*)::INTEGER AS n FROM ppi_pairs
          WHERE dataset_id = '${id}' AND publication_count > 1`,
      ),
    derived.datasetId,
  )
  expect(Number(replicated[0]!.n)).toBeGreaterThan(0)
})

test('refuses to derive an empty selection', async ({ page }) => {
  test.setTimeout(120_000)
  const message = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    try {
      await window.prolivis!.derive({ datasetId: ds!.datasetId })
      return null
    } catch (e) {
      return (e as Error).message
    }
  })
  expect(message).toMatch(/at least one publication/)
})
