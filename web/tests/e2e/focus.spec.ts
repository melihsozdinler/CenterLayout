import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/** Clicking a protein, and the density controls. */
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
  await page.evaluate(() => window.prolivis!.wipe())
  await page.reload()
  await page.setInputFiles('input[type="file"]', FIXTURE)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 120_000 })
})

const proteins = (page: Page) =>
  page
    .getByRole('banner')
    .textContent()
    .then((t) => Number((t?.match(/([\d,]+) proteins/)?.[1] ?? '0').replace(/,/g, '')))

test('searching a protein opens its interactions', async ({ page }) => {
  test.setTimeout(300_000)

  await page.getByPlaceholder(/Gene symbol/).fill('N')
  const hit = page.locator('.search-results button').first()
  await expect(hit).toBeVisible({ timeout: 60_000 })
  await hit.click()

  // The panel lists partners with the evidence behind each.
  await expect(page.locator('.protein')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/interaction partners/)).toBeVisible()
  const partners = page.locator('.partner-row')
  expect(await partners.count()).toBeGreaterThan(0)

  // And expanding one shows methods and publications, not just a count.
  await partners.first().click()
  const detail = page.locator('.partner-detail')
  await expect(detail).toBeVisible()
  await expect(detail.getByText('Methods', { exact: true })).toBeVisible()
  await expect(detail.getByText('Publications', { exact: true })).toBeVisible()
  await expect(detail.getByText('Throughput', { exact: true })).toBeVisible()
})

test('focusing switches to an ego view centred on the protein', async ({ page }) => {
  test.setTimeout(300_000)
  await page.getByPlaceholder(/Gene symbol/).fill('N')
  await page.locator('.search-results button').first().click()
  await expect(page.locator('.protein')).toBeVisible({ timeout: 60_000 })

  // Focusing implies the network view, showing only the neighbourhood.
  await expect(page.getByRole('button', { name: 'Network' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // The rebuild is asynchronous; poll rather than reading the header once.
  await expect.poll(() => proteins(page), { timeout: 60_000 }).toBeGreaterThan(0)
  const focused = await proteins(page)

  // Widening the hop count must widen the neighbourhood.
  await page.getByText(/Hops from/).locator('input').fill('2')
  await expect.poll(() => proteins(page), { timeout: 60_000 }).toBeGreaterThan(focused)
})

test('minimum-partners control thins the network', async ({ page }) => {
  test.setTimeout(300_000)
  await page.getByRole('button', { name: 'Network' }).click()
  await expect(page.getByRole('banner')).toContainText('proteins', { timeout: 120_000 })

  const before = await proteins(page)
  await page.getByText(/Minimum partners/).locator('input').fill('3')
  await expect.poll(() => proteins(page), { timeout: 60_000 }).toBeLessThan(before)
})
