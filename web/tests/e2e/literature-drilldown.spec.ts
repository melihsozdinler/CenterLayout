import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * From the literature to the interactions it reports — the drill-down the literature
 * view exists to enable, and which ProLiVis 1.0 offered from its publication list.
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
})

test('lists the biggest contributors before anything is typed', async ({ page }) => {
  test.setTimeout(300_000)

  const results = page.locator('.literature-results li')
  await expect(results.first()).toBeVisible({ timeout: 60_000 })
  expect(await results.count()).toBeGreaterThan(3)

  // Ordered by contribution, so the box answers "what is this network made of".
  const first = await results.first().textContent()
  expect(first).toMatch(/\d+ interactions/)
})

test('searching the literature finds a publication', async ({ page }) => {
  test.setTimeout(300_000)

  const label = await page
    .locator('.literature-results li strong')
    .first()
    .textContent()
  const author = (label ?? '').split(' ')[0]!

  await page.getByPlaceholder(/Author, year, PubMed/).fill(author)
  await expect
    .poll(() => page.locator('.literature-results li').count(), { timeout: 60_000 })
    .toBeGreaterThan(0)
  await expect(page.locator('.literature-results li strong').first()).toContainText(
    author,
  )
})

test('a publication opens the network it reported', async ({ page }) => {
  test.setTimeout(300_000)

  await expect(page.locator('.literature-results li').first()).toBeVisible({
    timeout: 60_000,
  })
  const label = await page.locator('.literature-results li strong').first().textContent()
  await page.locator('.literature-results li button').first().click()

  // Scoping implies the network view, restricted to that publication.
  await expect(page.getByRole('button', { name: 'Network', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 60_000 },
  )
  await expect(page.locator('.crumb-current')).toContainText(label!.trim(), {
    timeout: 60_000,
  })

  // The rebuild is asynchronous; poll rather than reading the header once.
  await expect.poll(async () => (await counts(page)).interactions, { timeout: 60_000 })
    .toBeGreaterThan(0)
  const scoped = await counts(page)

  // And the whole network is one click away, and larger.
  await page.getByRole('button', { name: /Whole network/ }).click()
  await expect(page.locator('.crumbs')).toBeHidden({ timeout: 60_000 })
  await expect.poll(async () => (await counts(page)).interactions, { timeout: 60_000 })
    .toBeGreaterThan(scoped.interactions)
})

test('scoping to an experimental method opens its interactions', async ({ page }) => {
  test.setTimeout(300_000)

  // The literature view advertises the interaction.
  await expect(page.locator('.legend-note')).toContainText(/click a method/)

  const expected = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const systems = await window.prolivis!.systems(ds!.datasetId)
    const name = systems[0]!.name
    const scored = await window.prolivis!.score({
      datasetId: ds!.datasetId,
      systems: [name],
    })
    return {
      name,
      interactions: scored.length,
      // The graph drops self-interactions, so that is what it should come to.
      nonSelf: scored.filter((p) => p.nodeLo !== p.nodeHi).length,
    }
  })

  // Every interaction a technique has produced — the same move as a publication,
  // one level up the hierarchy.
  const scored = await page.evaluate(
    async (name) =>
      (await window.prolivis!.graph({ datasetId: (await window.prolivis!.datasets())[0]!.datasetId, systems: [name] }, { minScore: 0 })).size,
    expected.name,
  )
  expect(scored).toBe(expected.nonSelf)
  expect(scored).toBeGreaterThan(0)
})

test('a scoped network shows every interaction, unfiltered by trust', async ({ page }) => {
  test.setTimeout(300_000)

  await expect(page.locator('.literature-results li').first()).toBeVisible({
    timeout: 60_000,
  })
  await page.locator('.literature-results li button').first().click()
  await expect(page.locator('.crumb-current')).toBeVisible({ timeout: 60_000 })

  // Nothing is hidden by the threshold while scoped: the header must not claim
  // anything is below it, because the request was to see this publication in full.
  const detail = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const top = await window.prolivis!.topPublications(ds!.datasetId, 1)
    const summary = await window.prolivis!.publication(ds!.datasetId, top[0]!.publicationKey)
    return { expected: summary!.interactionCount, proteins: summary!.proteinCount }
  })
  await expect.poll(async () => (await counts(page)).interactions, { timeout: 60_000 })
    .toBe(detail.expected)
  const shown = await counts(page)
  expect(shown.proteins).toBe(detail.proteins)

  // Nothing is hidden by the trust threshold while scoped: the request was to see
  // this publication in full, so the header must not claim anything is below it.
  expect(await page.getByRole('banner').textContent()).not.toMatch(/below threshold/)
})
