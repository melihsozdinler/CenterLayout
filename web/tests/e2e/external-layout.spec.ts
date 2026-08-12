import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/** Layout switching, breadcrumbs back to the whole graph, and database links. */
const FIXTURE = {
  name: 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
  mimeType: 'application/zip',
  buffer: readFileSync(
    fileURLToPath(new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url)),
  ),
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    void window.prolivis!.wipe()
    localStorage.removeItem('prolivis.externalResources')
  })
  await page.reload()
  await page.setInputFiles('input[type="file"]', FIXTURE)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(page.getByRole('banner')).toContainText('proteins', { timeout: 120_000 })
})

test('switches layout from the canvas toolbar', async ({ page }) => {
  test.setTimeout(300_000)

  const picker = page.locator('.layout-picker')
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('button', { name: 'Force' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const snapshot = async () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas')!
      return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.join(',')
        .length
    })

  for (const name of ['Layered', 'Grouped', 'Circular']) {
    await picker.getByRole('button', { name }).click()
    await expect(picker.getByRole('button', { name })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 60_000 },
    )
  }
  expect(await snapshot()).toBeGreaterThan(0)
})

test('a focused protein can be left again', async ({ page }) => {
  test.setTimeout(300_000)

  const count = () =>
    page
      .getByRole('banner')
      .textContent()
      .then((t) => Number((t?.match(/([\d,]+) proteins/)?.[1] ?? '0').replace(/,/g, '')))

  await page.getByPlaceholder(/Gene symbol/).fill('TBK1')
  await page.locator('.search-results button').first().click()
  await expect(page.locator('.protein')).toBeVisible({ timeout: 60_000 })

  // The rebuild is asynchronous, so wait for the crumb to name TBK1 before reading
  // the count — otherwise this captures the whole-network figure.
  await expect(page.locator('.crumb-current')).toHaveText('TBK1', { timeout: 60_000 })
  await page.waitForTimeout(500)
  const focused = await count()
  expect(focused).toBeGreaterThan(0)

  // Walking to a partner records a trail.
  await page.locator('.partner-row').first().click()
  await page.getByRole('button', { name: /^Centre on/ }).click()
  await expect(page.locator('.crumbs')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.locator('.crumb-current')).toHaveText('TBK1', { timeout: 60_000 })
  await expect.poll(count, { timeout: 60_000 }).toBe(focused)

  // And the whole network is one click away.
  await page.getByRole('button', { name: /Whole network/ }).click()
  await expect(page.locator('.crumbs')).toBeHidden({ timeout: 60_000 })
  await expect(page.locator('.layout-picker')).toBeVisible()
})

test('offers database links for the focused protein', async ({ page }) => {
  test.setTimeout(300_000)

  await page.getByPlaceholder(/Gene symbol/).fill('TBK1')
  await page.locator('.search-results button').first().click()
  await expect(page.locator('.protein')).toBeVisible({ timeout: 60_000 })

  const links = page.locator('.external-links button')
  expect(await links.count()).toBeGreaterThan(1)
  await expect(links.filter({ hasText: 'BioGRID' })).toBeVisible()

  // An embeddable resource opens beside the network, with a way out to a real tab.
  await links.filter({ hasText: 'BioGRID' }).first().click()
  const panel = page.locator('.external-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('iframe')).toHaveAttribute(
    'src',
    /thebiogrid\.org\/\d+/,
  )
  await expect(panel.getByRole('link', { name: /Open in a tab/ })).toBeVisible()

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toBeHidden()
})

test('database links are configurable', async ({ page }) => {
  test.setTimeout(300_000)

  await page.getByRole('button', { name: /External databases/ }).click()
  const list = page.locator('.resource-list li')
  const before = await list.count()
  expect(before).toBeGreaterThan(4)

  await page.getByLabel('Name').fill('Reactome')
  await page.getByLabel('Base URL').fill('https://reactome.org')
  await page.getByLabel('Template').fill('/content/query?q={symbol}')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(list).toHaveCount(before + 1)

  // It shows up for a protein, and survives a reload.
  await page.getByPlaceholder(/Gene symbol/).fill('TBK1')
  await page.locator('.search-results button').first().click()
  await expect(
    page.locator('.external-links button').filter({ hasText: 'Reactome' }),
  ).toBeVisible({ timeout: 60_000 })

  await page.reload()
  await page.getByRole('button', { name: /External databases/ }).click()
  await expect(page.locator('.resource-list li').filter({ hasText: 'Reactome' })).toBeVisible()
})

test('rejects a resource URL that is not a web address', async ({ page }) => {
  test.setTimeout(120_000)

  await page.getByRole('button', { name: /External databases/ }).click()
  await page.getByLabel('Name').fill('Bad')
  await page.getByLabel('Base URL').fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  // A template becomes an href; a javascript: URL there would run in our origin.
  await expect(page.getByRole('alert')).toContainText(/http and https/)
})
