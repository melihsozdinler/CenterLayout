import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * The user-facing path: load a file through the interface, see the layout, interact
 * with it. The API tests prove the numbers are right; these prove a person can get to
 * them.
 */

/**
 * Supplied under its real BioGRID name, because the dataset label — and therefore
 * the release recorded as provenance — is derived from the filename.
 */
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

/** Load the fixture through the file input, as a user would. */
async function loadThroughUi(page: Page) {
  await page.setInputFiles('input[type="file"]', FIXTURE)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 120_000 })
}

test('loads a file through the interface and draws the layout', async ({ page }) => {
  test.setTimeout(240_000)

  await expect(page.getByText('No dataset loaded.')).toBeVisible()
  await loadThroughUi(page)

  // The header reports what is on screen.
  await expect(page.getByRole('banner')).toContainText('publications')
  await expect(page.getByRole('banner')).toContainText('methods')

  // The dataset appears in the sidebar with its real counts.
  await expect(page.getByText('CORONAVIRUS 5.0.260')).toBeVisible()
  await expect(page.getByText(/975 records/)).toBeVisible()

  // And the canvas has actually painted something.
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const colours = new Set<string>()
    for (let i = 0; i < data.length; i += 4 * 97) {
      colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    }
    return colours.size
  })
  expect(painted).toBeGreaterThan(5)
})

test('offers the organisms present in the file', async ({ page }) => {
  test.setTimeout(240_000)
  await loadThroughUi(page)

  const organisms = page.locator('select').first()
  await expect(organisms).toBeVisible()
  const options = await organisms.locator('option').allTextContents()

  expect(options.some((o) => o.includes('Severe acute respiratory syndrome'))).toBe(true)
  expect(options.some((o) => o.includes('Homo sapiens'))).toBe(true)
  // The old tool shipped a hard-coded list of 48 species; this one reads the file.
  expect(options.length).toBeGreaterThan(3)
})

test('re-lays out when the aggregation threshold changes', async ({ page }) => {
  test.setTimeout(240_000)
  await loadThroughUi(page)

  const before = await page.evaluate(() => document.body.textContent ?? '')
  // By name: the publication filter puts four more number inputs on this panel.
  const fold = page.getByRole('spinbutton', { name: 'Fold methods with fewer than' })
  await fold.fill('5')
  await fold.blur()

  // The header's method count must fall as rare methods fold into one node.
  await expect
    .poll(async () => page.evaluate(() => document.body.textContent ?? ''), {
      timeout: 60_000,
    })
    .not.toBe(before)
})

test('exports the figure as an SVG file', async ({ page }) => {
  test.setTimeout(240_000)
  await loadThroughUi(page)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /export figure as svg/i }).click(),
  ])

  expect(download.suggestedFilename()).toBe('prolivis-center-layout.svg')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const svg = Buffer.concat(chunks).toString('utf8')

  expect(svg.startsWith('<svg')).toBe(true)
  // One circle per node. The interface opens on the most abundant organism rather
  // than the whole cross-species file, so this is a subset of the 184 nodes the
  // dataset-wide layout produces.
  expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThan(100)
})

test('survives a reload, because the database is persistent', async ({ page }) => {
  test.setTimeout(240_000)
  await loadThroughUi(page)

  // Wait until the load is readable and settled before reloading. Without this the
  // test races the outgoing worker's flush rather than testing durability.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const rows = await window.prolivis!.sql<{ n: number }>(
            'SELECT count(*)::INTEGER AS n FROM interactions',
          )
          return Number(rows[0]?.n ?? 0)
        }),
      { timeout: 60_000 },
    )
    .toBe(975)
  await page.evaluate(async () => (await window.prolivis!.engine()).checkpoint())

  await page.reload()

  // No re-upload: the dataset is still there, which is what makes a 3M-record
  // ingest worth paying for once.
  await expect(page.getByText('CORONAVIRUS 5.0.260')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('canvas')).toBeVisible()
})

test('shows a useful message when given the wrong kind of file', async ({ page }) => {
  test.setTimeout(120_000)

  await page.setInputFiles('input[type="file"]', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is not biogrid data\n'),
  })

  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 60_000 })
  await expect(alert).toContainText(/tab3/)
})
