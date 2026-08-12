import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/** The network and matrix views, and merging, through the interface. */
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
})

async function load(page: Page, name = FIXTURE.name) {
  await page.setInputFiles('input[type="file"]', { ...FIXTURE, name })
  await expect(page.locator('canvas')).toBeVisible({ timeout: 120_000 })
}

test('switches to the network view and draws the interactions', async ({ page }) => {
  test.setTimeout(300_000)
  await load(page)

  await page.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(page.getByRole('banner')).toContainText('proteins', { timeout: 120_000 })
  await expect(page.getByRole('banner')).toContainText('interactions')

  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
    const colours = new Set<string>()
    for (let i = 0; i < data.length; i += 4 * 97) colours.add(`${data[i]},${data[i+1]},${data[i+2]}`)
    return colours.size
  })
  expect(painted).toBeGreaterThan(5)
})

test('raising the trust threshold shrinks the network', async ({ page }) => {
  test.setTimeout(300_000)
  await load(page)
  await page.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(page.getByRole('banner')).toContainText('proteins', { timeout: 120_000 })

  const count = async () =>
    Number(
      (
        (await page.getByRole('banner').textContent())?.match(
          /([\d,]+) proteins/,
        )?.[1] ?? '0'
      ).replace(/,/g, ''),
    )

  const before = await count()
  await page.getByRole('slider', { name: /Minimum trust/ }).fill('0.4')
  await expect.poll(count, { timeout: 60_000 }).toBeLessThan(before)
})

test('switches to the matrix view', async ({ page }) => {
  test.setTimeout(300_000)
  await load(page)
  await page.getByRole('button', { name: 'Matrix', exact: true }).click()
  await expect(page.getByRole('banner')).toContainText('proteins', { timeout: 120_000 })
  await expect(page.getByText(/Row order/)).toBeVisible()
})

test('compares and merges two datasets from the interface', async ({ page }) => {
  test.setTimeout(300_000)
  await load(page)
  await load(page, 'BIOGRID-CORONAVIRUS-5.0.260-copy.tab3.zip')

  await page.getByRole('combobox').filter({ hasText: /Compare with/ }).selectOption({ index: 1 })

  // The same data against itself: nothing exclusive to either side.
  await expect(page.getByText('Agreement')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('100.0%')).toBeVisible()

  await page.getByRole('button', { name: /Merge into a new dataset/ }).click()
  await expect(page.getByText(/^CORONAVIRUS 5.0.260 \+ /)).toBeVisible({ timeout: 120_000 })

  // Merging identical data must not double the records.
  const records = await page.evaluate(async () => {
    const datasets = await window.prolivis!.datasets()
    return datasets[datasets.length - 1]!.recordCount
  })
  expect(records).toBe(975)
})
