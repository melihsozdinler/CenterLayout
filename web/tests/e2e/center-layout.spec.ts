import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * The center layout over real BioGRID data, end to end.
 *
 * The properties worth pinning here are the ones that make the figure trustworthy:
 * that a publication using several methods appears once rather than being filed under
 * an arbitrary one, and that the same query always draws the same picture.
 */

const FIXTURE_BYTES = [
  ...readFileSync(
    fileURLToPath(new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url)),
  ),
]

async function loadFixture(page: Page) {
  return page.evaluate(async (bytes) => {
    const file = new File(
      [new Uint8Array(bytes)],
      'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
    )
    return window.prolivis!.load(file)
  }, FIXTURE_BYTES)
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())
})

test('draws the three levels from a real dataset', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const layout = await page.evaluate(
    (id) => window.prolivis!.centerLayout({ datasetId: id }),
    dataset.datasetId,
  )

  const kinds = new Map<string, number>()
  for (const node of layout.nodes) {
    kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1)
  }
  expect(kinds.get('organism')).toBe(1)
  // The fixture contains 19 distinct experimental systems and 164 publications.
  expect(kinds.get('system')).toBe(19)
  expect(kinds.get('publication')).toBe(164)

  expect(layout.sectors).toHaveLength(19)
  expect(layout.extent).toBeGreaterThan(0)
})

test('gives multi-method publications one node with an edge to each method', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const layout = await page.evaluate(
    (id) => window.prolivis!.centerLayout({ datasetId: id }),
    dataset.datasetId,
  )

  const multi = layout.nodes.filter(
    (n) => n.kind === 'publication' && (n.systems?.length ?? 0) > 1,
  )
  expect(multi.length).toBeGreaterThan(0)

  // The defect this fixes: ProLiVis 1.0's GROUP BY left each publication attached to
  // one arbitrary method, so these edges did not exist.
  for (const node of multi.slice(0, 5)) {
    const edges = layout.edges.filter((e) => e.target === node.id)
    expect(edges).toHaveLength(node.systems!.length)
  }

  // Every publication appears exactly once.
  const ids = layout.nodes.filter((n) => n.kind === 'publication').map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
})

test('is reproducible: the same query draws identical coordinates', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const [first, second] = await page.evaluate(
    async (id) => [
      await window.prolivis!.centerLayout({ datasetId: id }),
      await window.prolivis!.centerLayout({ datasetId: id }),
    ],
    dataset.datasetId,
  )

  // The property ProLiVis 1.0 could not offer: its force-directed engine drew the
  // same data differently every run, so no published figure could be regenerated.
  expect(JSON.stringify(first!.nodes)).toBe(JSON.stringify(second!.nodes))
})

test('narrows to a single organism', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const [all, sars] = await page.evaluate(
    async (id) => [
      await window.prolivis!.centerLayout({ datasetId: id }),
      await window.prolivis!.centerLayout({ datasetId: id, organismId: 2697049 }),
    ],
    dataset.datasetId,
  )

  expect(sars!.nodes.length).toBeLessThan(all!.nodes.length)
  const centre = sars!.nodes.find((n) => n.kind === 'organism')!
  expect(centre.label).toContain('coronavirus')
})

test('folds the long tail of rare methods into an aggregate node', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const layout = await page.evaluate(
    (id) => window.prolivis!.centerLayout({ datasetId: id }, { aggregateBelow: 3 }),
    dataset.datasetId,
  )

  const aggregate = layout.nodes.find((n) => n.kind === 'aggregate')
  expect(aggregate).toBeDefined()
  expect(aggregate!.aggregated!.length).toBeGreaterThan(1)
  expect(layout.nodes.filter((n) => n.kind === 'system').length).toBeLessThan(19)

  // No publication may be orphaned by the fold.
  const publications = layout.nodes.filter((n) => n.kind === 'publication')
  for (const node of publications) {
    expect(layout.edges.some((e) => e.target === node.id)).toBe(true)
  }
})

test('exports a scene as standalone, editable SVG', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const svg = await page.evaluate(async (id) => {
    const layout = await window.prolivis!.centerLayout({ datasetId: id })
    const scene = window.prolivis!.centerScene(layout)
    return window.prolivis!.toSvg(scene, 'Coronavirus literature')
  }, dataset.datasetId)

  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg).toContain('</svg>')
  expect(svg).toContain('<title>Coronavirus literature</title>')
  // Every node is a separate element, so the figure is editable rather than a raster.
  expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThan(150)
  expect(svg).toContain('<text')

  // It must be well-formed XML, not merely string-concatenated.
  const parsed = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    return {
      error: doc.querySelector('parsererror')?.textContent ?? null,
      circles: doc.querySelectorAll('circle').length,
      root: doc.documentElement.nodeName,
    }
  }, svg)

  expect(parsed.error).toBeNull()
  expect(parsed.root).toBe('svg')
  expect(parsed.circles).toBeGreaterThan(150)
})

test('escapes publication labels rather than emitting broken XML', async ({ page }) => {
  test.setTimeout(120_000)

  // BioGRID author labels are free text and have contained ampersands.
  const svg = await page.evaluate(() => {
    const layout = window.prolivis!.centerScene({
      nodes: [
        {
          id: 'x',
          kind: 'publication',
          label: 'Smith & Jones <2001> "landmark"',
          x: 0,
          y: 0,
          radius: 5,
          angle: 0,
          distance: 0,
          ring: 2,
          interactionCount: 1,
        },
      ],
      edges: [],
      sectors: [],
      extent: 10,
    })
    return window.prolivis!.toSvg(layout)
  })

  expect(svg).toContain('&amp;')
  expect(svg).toContain('&lt;2001&gt;')
  expect(svg).not.toContain('& ')
})
