import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Reading a network one level up, and drilling back down into it.
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
  // The canvas appears as soon as there is something to draw, which is well before
  // ingest has finished; `record_count` is written once, at the end.
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.prolivis!.datasets()))[0]?.recordCount ?? 0,
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Network', exact: true }).click()
})

/** Turn the trust threshold down to zero so the whole network is in play. */
async function showEverything(page: Page) {
  const slider = page.locator('input[type="range"]').first()
  await slider.fill('0')
  await expect.poll(() => page.locator('canvas').count(), { timeout: 60_000 }).toBe(1)
}

test('switches to the modules view and reports what it drew', async ({ page }) => {
  test.setTimeout(300_000)
  await showEverything(page)

  await page.getByRole('button', { name: 'Modules', exact: true }).click()

  const crumbs = page.locator('.crumbs.drill')
  await expect(crumbs).toBeVisible({ timeout: 60_000 })
  await expect(crumbs).toContainText(/\d+ modules/)
  await expect(crumbs).toContainText('click one to open it')

  // The module count is what makes this view readable; a hairball of modules is no
  // better than a hairball of proteins.
  const text = (await crumbs.textContent()) ?? ''
  const modules = Number(text.match(/(\d+) modules/)?.[1] ?? '0')
  expect(modules).toBeGreaterThan(1)
  expect(modules).toBeLessThanOrEqual(60)
})

test('every protein is in exactly one module', async ({ page }) => {
  test.setTimeout(300_000)

  const check = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const scored = await window.prolivis!.score({
      datasetId: ds!.datasetId,
      physicalOnly: true,
      excludeSelfInteractions: true,
    })
    const graph = window.prolivis!.graphFrom(scored)
    const high = window.prolivis!.autoContract(graph)

    const counts = new Map<number, number>()
    for (const node of high.nodes) {
      for (const member of node.members) counts.set(member, (counts.get(member) ?? 0) + 1)
    }
    return {
      order: graph.order,
      covered: counts.size,
      duplicated: [...counts.values()].filter((n) => n > 1).length,
      ungrouped: high.ungrouped.length,
      modules: high.nodes.length,
      strategy: high.strategy,
      largest: Math.max(...high.nodes.map((n) => n.size)),
    }
  })

  expect(check.covered).toBe(check.order)
  expect(check.duplicated).toBe(0)
  expect(check.ungrouped).toBe(0)
  expect(check.modules).toBeGreaterThan(1)
  // Progress: a contraction whose biggest module is the whole graph is not a level up.
  expect(check.largest).toBeLessThan(check.order)
})

test('opens a module and can walk back out', async ({ page }) => {
  test.setTimeout(300_000)
  await showEverything(page)
  await page.getByRole('button', { name: 'Modules', exact: true }).click()
  // The breadcrumb appears with the switch; the contracted graph arrives when the
  // rebuild finishes.
  await expect
    .poll(
      () => page.evaluate(() => window.prolivis!.ui!.getState().highLevel !== null),
      { timeout: 60_000 },
    )
    .toBe(true)

  // Open the largest module.
  const target = await page.evaluate(() => {
    const state = window.prolivis!.ui!.getState()
    const nodes = [...state.highLevel!.nodes].sort((a, b) => b.size - a.size)
    return { id: nodes[0]!.id, label: nodes[0]!.label, size: nodes[0]!.size }
  })

  await page.evaluate((id) => window.prolivis!.ui!.getState().drillInto(id), target.id)

  const crumbs = page.locator('.crumbs.drill')
  await expect(crumbs).toContainText(target.label, { timeout: 60_000 })
  await expect(crumbs).toContainText(target.size.toLocaleString())

  // What is drawn inside is that module's proteins, not the whole network again.
  const inside = await page.evaluate(() => {
    const state = window.prolivis!.ui!.getState()
    return {
      drill: state.drill.length,
      proteins: state.networkStats?.nodes ?? 0,
      contracted: state.highLevel !== null,
    }
  })
  expect(inside.drill).toBe(1)
  expect(inside.proteins).toBeLessThanOrEqual(target.size)
  expect(inside.proteins).toBeGreaterThan(0)

  await page.getByRole('button', { name: '← Whole network' }).click()
  await expect
    .poll(() => page.evaluate(() => window.prolivis!.ui!.getState().drill.length), {
      timeout: 60_000,
    })
    .toBe(0)
})

test('a module too large to draw as proteins contracts again', async ({ page }) => {
  test.setTimeout(300_000)

  // The recursion, checked directly: contract, take the biggest module, contract that.
  // Descending into the same picture forever is the failure mode this rules out.
  const levels = await page.evaluate(async () => {
    const [ds] = await window.prolivis!.datasets()
    const scored = await window.prolivis!.score({ datasetId: ds!.datasetId })
    let graph = window.prolivis!.graphFrom(scored)

    const trail: { order: number; modules: number; strategy: string }[] = []
    for (let depth = 0; depth < 6 && graph.order > 8; depth += 1) {
      const high = window.prolivis!.autoContract(graph)
      trail.push({
        order: graph.order,
        modules: high.nodes.length,
        strategy: high.strategy,
      })
      const biggest = [...high.nodes].sort((a, b) => b.size - a.size)[0]!
      const keep = new Set<number>()
      for (const id of biggest.members) {
        const index = graph.index(id)
        if (index !== undefined) keep.add(index)
      }
      if (keep.size === graph.order) break
      graph = graph.induced(keep)
    }
    return trail
  })

  expect(levels.length).toBeGreaterThan(1)
  // Strictly smaller every time: that is what makes the descent terminate.
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i]!.order).toBeLessThan(levels[i - 1]!.order)
  }
})

test('drops back to proteins when the layout buttons are used', async ({ page }) => {
  test.setTimeout(300_000)
  await showEverything(page)
  await page.getByRole('button', { name: 'Modules', exact: true }).click()
  await expect
    .poll(
      () => page.evaluate(() => window.prolivis!.ui!.getState().highLevel !== null),
      { timeout: 60_000 },
    )
    .toBe(true)

  await page.getByRole('button', { name: 'Force', exact: true }).click()
  await expect(page.locator('.crumbs.drill')).toBeHidden({ timeout: 60_000 })
  await expect
    .poll(
      () => page.evaluate(() => window.prolivis!.ui!.getState().highLevel === null),
      { timeout: 60_000 },
    )
    .toBe(true)
  expect(
    await page.evaluate(() => window.prolivis!.ui!.getState().network !== null),
  ).toBe(true)
})
