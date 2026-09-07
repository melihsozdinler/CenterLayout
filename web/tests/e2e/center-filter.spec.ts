import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Filtering the literature before it is drawn.
 *
 * Every publication is one node in the center layout whatever it reported, so the
 * filters are what separate a field's structure papers from its largest screens.
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
  await page.setInputFiles('input[type="file"]', FIXTURE)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 120_000 })
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.prolivis!.datasets()))[0]?.recordCount ?? 0,
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0)
  await expect(page.locator('.panel.filter')).toBeVisible({ timeout: 60_000 })
  // The method list is loaded after the layout, so the panel exists before it is
  // complete. Every test below expects a method to click.
  await expect
    .poll(async () => (await state(page)).systems.length, { timeout: 60_000 })
    .toBeGreaterThan(1)
})

const state = (page: Page) => page.evaluate(() => window.prolivis!.ui!.getState())

/**
 * Publications counted the way the layout counts them.
 *
 * Not `topPublications`: that reads the precomputed dataset-wide `pair_count`, so a
 * host-pathogen paper carries its total there while the layout counts only what it
 * contributed to the organism on screen. Both numbers are right; they are answers to
 * different questions, and a test that mixed them would be testing neither.
 */
async function countingLikeTheLayout(page: Page) {
  return page.evaluate(async () => {
    const { activeDatasetId, activeOrganismId } = window.prolivis!.ui!.getState()
    const organism =
      activeOrganismId === null
        ? ''
        : ` AND (organism_id_a = ${activeOrganismId} OR organism_id_b = ${activeOrganismId})`
    return (await window.prolivis!.sql(
      `SELECT publication_key AS k,
              count(DISTINCT pair_key)::INTEGER AS interactions,
              count(DISTINCT gene)::INTEGER     AS proteins
         FROM (SELECT publication_key, pair_key,
                      unnest([biogrid_id_a, biogrid_id_b]) AS gene
                 FROM interactions
                WHERE dataset_id = '${activeDatasetId}'
                  AND experimental_system IS NOT NULL
                  AND publication_key IS NOT NULL${organism})
        GROUP BY 1`,
    )) as { k: string; interactions: number; proteins: number }[]
  })
}


/** Publications currently drawn, and what the layout says it kept. */
async function drawn(page: Page) {
  return page.evaluate(() => {
    const layout = window.prolivis!.ui!.getState().layout!
    return {
      nodes: layout.nodes.filter((n) => n.kind === 'publication').length,
      systems: layout.nodes.filter((n) => n.kind === 'system' || n.kind === 'aggregate')
        .length,
      after: layout.filter!.publicationsAfter,
      before: layout.filter!.publicationsBefore,
      interactionRange: layout.filter!.interactionRange,
      proteinRange: layout.filter!.proteinRange,
    }
  })
}

test('reports the range of the literature it is drawing', async ({ page }) => {
  test.setTimeout(300_000)
  const shown = await drawn(page)

  expect(shown.after).toBe(shown.before)
  expect(shown.nodes).toBe(shown.after)
  expect(shown.interactionRange[0]).toBeGreaterThan(0)
  expect(shown.interactionRange[1]).toBeGreaterThanOrEqual(shown.interactionRange[0])
  // A publication reports at least two proteins per interaction, and usually more.
  expect(shown.proteinRange[0]).toBeGreaterThanOrEqual(2)
  expect(shown.proteinRange[1]).toBeGreaterThanOrEqual(shown.interactionRange[1] > 1 ? 3 : 2)

  await expect(page.locator('.panel.filter')).toContainText(
    `${shown.before.toLocaleString()} publications`,
  )
})

test('filters by how many interactions a publication contributed', async ({ page }) => {
  test.setTimeout(300_000)
  const before = await drawn(page)
  const cut = Math.max(2, Math.round(before.interactionRange[1] / 4))

  await page
    .getByLabel('Interactions per publication, at least', { exact: true })
    .fill(String(cut))
  await page.keyboard.press('Enter')

  await expect
    .poll(async () => (await drawn(page)).after, { timeout: 60_000 })
    .toBeLessThan(before.after)

  const after = await drawn(page)
  expect(after.before).toBe(before.before)
  expect(after.nodes).toBe(after.after)

  // Every surviving publication really does clear the bar, checked against the data
  // rather than against the number the panel prints.
  const rows = await countingLikeTheLayout(page)
  expect(after.after).toBe(rows.filter((r) => r.interactions >= cut).length)
})

test('filters by how many proteins a publication touched', async ({ page }) => {
  test.setTimeout(300_000)
  const before = await drawn(page)
  const cut = Math.max(3, Math.round(before.proteinRange[1] / 3))

  await page.getByLabel('Proteins per publication, at least', { exact: true }).fill(String(cut))
  await page.keyboard.press('Enter')

  await expect
    .poll(async () => (await drawn(page)).after, { timeout: 60_000 })
    .toBeLessThan(before.after)

  const rows = await countingLikeTheLayout(page)
  const after = await drawn(page)
  expect(after.after).toBe(rows.filter((r) => r.proteins >= cut).length)

  // Proteins and interactions are different questions, and this is the statement of
  // that: publications reporting the same number of interactions can touch different
  // numbers of proteins — ten interactions among three proteins, or among twenty — so
  // one filter cannot stand in for the other.
  const byInteractions = new Map<number, Set<number>>()
  for (const row of rows) {
    const seen = byInteractions.get(row.interactions) ?? new Set<number>()
    seen.add(row.proteins)
    byInteractions.set(row.interactions, seen)
  }
  expect([...byInteractions.values()].some((proteins) => proteins.size > 1)).toBe(true)
})

test('an upper bound hides the screens', async ({ page }) => {
  test.setTimeout(300_000)
  const before = await drawn(page)

  await page
    .getByLabel('Interactions per publication, at most', { exact: true })
    .fill('2')
  await page.keyboard.press('Enter')

  await expect
    .poll(async () => (await drawn(page)).after, { timeout: 60_000 })
    .toBeLessThan(before.after)

  // Checked against the data rather than against node sizes: publication radius is
  // normalised to the largest publication *in the current view*, so the biggest node
  // stays the biggest node however small the survivors are.
  const rows = await countingLikeTheLayout(page)
  const after = await drawn(page)
  expect(after.after).toBe(rows.filter((r) => r.interactions <= 2).length)
  expect(after.nodes).toBe(after.after)
})

test('filters by method, and the method ring follows', async ({ page }) => {
  test.setTimeout(300_000)
  const before = await drawn(page)
  expect(before.systems).toBeGreaterThan(1)

  const method = await page.evaluate(
    () => window.prolivis!.ui!.getState().systems[0]!.name,
  )
  await page.getByRole('checkbox', { name: method, exact: false }).first().click()

  await expect
    .poll(async () => (await drawn(page)).systems, { timeout: 60_000 })
    .toBe(1)

  const after = await drawn(page)
  expect(after.after).toBeLessThanOrEqual(before.after)
  expect((await state(page)).layoutSettings.systems).toEqual([method])
})

test('the method ring is recomputed from the publications that survived', async ({
  page,
}) => {
  test.setTimeout(300_000)

  // The sector widths are shares of the literature. If they were computed over the
  // whole dataset while the fan showed a filtered subset, the picture would claim a
  // method contributed papers that are not drawn.
  const before = await page.evaluate(() => {
    const layout = window.prolivis!.ui!.getState().layout!
    return layout.sectors.map((s) => ({ system: s.system, span: s.endAngle - s.startAngle }))
  })

  await page.evaluate(() =>
    window.prolivis!.ui!.getState().updateSettings({ minInteractions: 3 }),
  )
  await expect
    .poll(async () => (await drawn(page)).after, { timeout: 60_000 })
    .toBeLessThan(before.length === 0 ? 1 : 1e9)

  const after = await page.evaluate(() => {
    const layout = window.prolivis!.ui!.getState().layout!
    return {
      sectors: layout.sectors.map((s) => ({
        system: s.system,
        span: s.endAngle - s.startAngle,
      })),
      publications: layout.nodes.filter((n) => n.kind === 'publication').length,
    }
  })

  expect(after.sectors).not.toEqual(before)

  // The sectors still tile the circle: every span positive, and together they account
  // for the whole of it apart from the fixed gap drawn between adjacent sectors.
  const PADDING = 0.012
  expect(after.sectors.every((s) => s.span > 0)).toBe(true)
  const total = after.sectors.reduce((sum, s) => sum + s.span, 0)
  expect(total + PADDING * after.sectors.length).toBeCloseTo(Math.PI * 2, 6)
})

test('the boxes follow the filter, however it was set', async ({ page }) => {
  test.setTimeout(300_000)
  const box = page.getByLabel('Interactions per publication, at least', { exact: true })

  // Set from outside the panel — a manifest, a script, or the clear button below.
  await page.evaluate(() =>
    window.prolivis!.ui!.getState().updateSettings({ minInteractions: 4 }),
  )
  await expect(box).toHaveValue('4', { timeout: 60_000 })

  await page.getByRole('button', { name: 'clear' }).click()
  await expect(box).toHaveValue('', { timeout: 60_000 })
})

test('clearing restores the whole literature', async ({ page }) => {
  test.setTimeout(300_000)
  const before = await drawn(page)

  await page.evaluate(() =>
    window.prolivis!.ui!.getState().updateSettings({ minInteractions: 5, minProteins: 5 }),
  )
  await expect
    .poll(async () => (await drawn(page)).after, { timeout: 60_000 })
    .toBeLessThan(before.after)

  await page.getByRole('button', { name: 'clear' }).click()
  await expect
    .poll(async () => (await drawn(page)).after, { timeout: 60_000 })
    .toBe(before.after)
})

test('a manifest carries the filter, so the figure comes back filtered', async ({
  page,
}) => {
  test.setTimeout(300_000)

  const check = await page.evaluate(async () => {
    const { activeDatasetId: id, activeOrganismId: organismId } =
      window.prolivis!.ui!.getState()
    const datasets = await window.prolivis!.datasets()
    const summary = datasets.find((d) => d.datasetId === id)!

    const publicationFilter = { minInteractions: 3, systems: ['Affinity Capture-MS'] }
    const text = window.prolivis!.serializeManifest(
      window.prolivis!.manifest({
        dataset: summary,
        layout: { aggregateBelow: 0 },
        publicationFilter,
        ...(organismId === null ? {} : { organismId }),
        note: 'the filtered figure',
      }),
    )
    const { manifest } = window.prolivis!.parseManifest(text)

    // The figure the manifest describes, rebuilt from the manifest alone.
    const rebuilt = await window.prolivis!.centerLayout(
      {
        datasetId: id!,
        ...(manifest.organismId === null ? {} : { organismId: manifest.organismId }),
        ...manifest.publicationFilter,
      },
      manifest.layout!,
    )
    const unfiltered = await window.prolivis!.centerLayout(
      {
        datasetId: id!,
        ...(manifest.organismId === null ? {} : { organismId: manifest.organismId }),
      },
      manifest.layout!,
    )

    return {
      recorded: manifest.publicationFilter,
      rebuilt: rebuilt.nodes.filter((n) => n.kind === 'publication').length,
      unfiltered: unfiltered.nodes.filter((n) => n.kind === 'publication').length,
    }
  })

  expect(check.recorded).toEqual({
    minInteractions: 3,
    systems: ['Affinity Capture-MS'],
  })
  // Without the filter the manifest would reproduce a different picture, which is the
  // whole point of recording it.
  expect(check.rebuilt).toBeLessThan(check.unfiltered)
  expect(check.rebuilt).toBeGreaterThan(0)
})

