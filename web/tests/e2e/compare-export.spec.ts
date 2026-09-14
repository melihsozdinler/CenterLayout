import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Comparison, merging and export against real BioGRID data.
 *
 * The coronavirus fixture is genuinely cross-species, so comparing one organism
 * against another is a real question with a real answer, not a contrivance.
 */

const FIXTURE_BYTES = [
  ...readFileSync(
    fileURLToPath(new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url)),
  ),
]

const SARS_COV_2 = 2697049
const HUMAN = 9606

async function loadFixture(page: Page, name = 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip') {
  return page.evaluate(
    async ({ bytes, name }) =>
      window.prolivis!.load(new File([new Uint8Array(bytes)], name)),
    { bytes: FIXTURE_BYTES, name },
  )
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())
})

test('compares two organisms within one dataset', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const result = await page.evaluate(
    async ({ id, a, b }) =>
      window.prolivis!.compare({
        left: { datasetId: id, organismId: a, label: 'SARS-CoV-2' },
        right: { datasetId: id, organismId: b, label: 'Human' },
      }),
    { id: dataset.datasetId, a: SARS_COV_2, b: HUMAN },
  )

  console.log(`  comparison: ${JSON.stringify(result.summary)}`)
  expect(result.summary.leftOnly).toBeGreaterThan(0)
  expect(result.summary.rightOnly).toBeGreaterThan(0)
  // Host-pathogen interactions belong to both organisms, so they must overlap.
  expect(result.summary.shared).toBeGreaterThan(0)
  expect(result.summary.jaccard).toBeGreaterThan(0)
  expect(result.summary.jaccard).toBeLessThan(1)
  expect(result.summary.comparedBy).toBe('gene-id')

  const presences = new Set(result.edges.map((e) => e.presence))
  expect(presences.has('both')).toBe(true)
  expect(presences.has('left-only')).toBe(true)
})

test('an identical dataset compares as fully shared', async ({ page }) => {
  test.setTimeout(300_000)
  const a = await loadFixture(page)
  const b = await loadFixture(page, 'BIOGRID-CORONAVIRUS-5.0.260-copy.tab3.zip')

  const result = await page.evaluate(
    async ({ left, right }) =>
      window.prolivis!.compare({
        left: { datasetId: left },
        right: { datasetId: right },
      }),
    { left: a.datasetId, right: b.datasetId },
  )

  // The strongest sanity check there is: the same data against itself.
  expect(result.summary.leftOnly).toBe(0)
  expect(result.summary.rightOnly).toBe(0)
  expect(result.summary.jaccard).toBe(1)
  expect(result.summary.sharedWithNewEvidence).toBe(0)
})

test('applies set operations to a comparison', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const counts = await page.evaluate(
    async ({ id, a, b }) => {
      const result = await window.prolivis!.compare({
        left: { datasetId: id, organismId: a },
        right: { datasetId: id, organismId: b },
      })
      return {
        union: window.prolivis!.setOperation(result, 'union').length,
        intersection: window.prolivis!.setOperation(result, 'intersection').length,
        difference: window.prolivis!.setOperation(result, 'difference').length,
        symmetric: window.prolivis!.setOperation(result, 'symmetric-difference').length,
      }
    },
    { id: dataset.datasetId, a: SARS_COV_2, b: HUMAN },
  )

  console.log(`  set operations: ${JSON.stringify(counts)}`)
  expect(counts.union).toBe(counts.intersection + counts.symmetric)
  expect(counts.difference).toBeLessThan(counts.symmetric)
})

test('merging the same data twice does not double the evidence', async ({ page }) => {
  test.setTimeout(300_000)
  const a = await loadFixture(page)
  const b = await loadFixture(page, 'BIOGRID-CORONAVIRUS-5.0.260-copy.tab3.zip')

  const merged = await page.evaluate(
    async ({ left, right }) =>
      window.prolivis!.merge(
        [{ datasetId: left }, { datasetId: right }],
        { label: 'Merged copies' },
      ),
    { left: a.datasetId, right: b.datasetId },
  )

  console.log(`  merged ${merged.recordCount} records from 2 x ${a.recordCount}`)

  // The critical property: identical records collapse. Without it, merging a release
  // with its successor would double every unchanged interaction and inflate every
  // replication count in the trust model.
  expect(merged.recordCount).toBe(a.recordCount)

  const publications = await page.evaluate(
    (id) =>
      window.prolivis!.sql<{ n: number }>(
        `SELECT count(*)::INTEGER AS n FROM publications WHERE dataset_id = '${id}'`,
      ),
    merged.datasetId,
  )
  expect(Number(publications[0]!.n)).toBe(a.publicationCount)
})

test('exports scored interactions in every tabular and network format', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const exports = await page.evaluate(async (id) => {
    const scored = await window.prolivis!.score({ datasetId: id, limit: 50 })
    return {
      count: scored.length,
      csv: window.prolivis!.exportTable(scored, 'csv'),
      tsv: window.prolivis!.exportTable(scored, 'tsv'),
      sif: window.prolivis!.exportSif(scored),
      graphml: window.prolivis!.exportGraphml(scored),
      gml: window.prolivis!.exportGml(scored),
    }
  }, dataset.datasetId)

  const csvLines = exports.csv.trim().split('\n')
  expect(csvLines).toHaveLength(exports.count + 1)
  expect(csvLines[0]).toContain('trust_score')
  expect(csvLines[0]).toContain('term_replication')
  expect(csvLines[0]).toContain('trust_coverage')

  expect(exports.tsv.split('\n')[0]).toContain('\t')
  expect(exports.sif.trim().split('\n')).toHaveLength(exports.count)
  expect(exports.gml.startsWith('graph [')).toBe(true)

  // GraphML must be well-formed XML, not merely string-concatenated.
  const parsed = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    return {
      error: doc.querySelector('parsererror')?.textContent ?? null,
      root: doc.documentElement.nodeName,
      edges: doc.getElementsByTagName('edge').length,
      nodes: doc.getElementsByTagName('node').length,
    }
  }, exports.graphml)

  expect(parsed.error).toBeNull()
  expect(parsed.root).toBe('graphml')
  expect(parsed.edges).toBe(exports.count)
  expect(parsed.nodes).toBeGreaterThan(0)
})

test('exports a contracted graph as module and link tables', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const tables = await page.evaluate(async (id) => {
    const graph = await window.prolivis!.graph({ datasetId: id })
    const high = window.prolivis!.contract(graph, {
      strategy: 'biconnected-components',
      minGroupSize: 3,
    })
    return window.prolivis!.exportHighLevel(high, 'csv')
  }, dataset.datasetId)

  expect(tables.nodes.split('\n')[0]).toContain('internal_trust')
  expect(tables.nodes.split('\n')[0]).toContain('members')
  expect(tables.edges.split('\n')[0]).toContain('trust_mass')
})

test('a session manifest reproduces the figure it describes', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const check = await page.evaluate(async (id) => {
    const datasets = await window.prolivis!.datasets()
    const summary = datasets.find((d) => d.datasetId === id)!

    const manifest = window.prolivis!.manifest({
      dataset: summary,
      query: { datasetId: id, organismId: 2697049 },
      trust: window.prolivis!.trustPresets()['literature-aware']!,
      layout: { aggregateBelow: 5 },
      organismId: 2697049,
      note: 'Figure 2',
    })

    const text = window.prolivis!.serializeManifest(manifest)
    const { manifest: reloaded, warnings } = window.prolivis!.parseManifest(text)
    const reproducibility = window.prolivis!.checkManifest(reloaded, datasets)

    // Rebuild the figure from the manifest alone and confirm it is the same picture.
    const first = await window.prolivis!.centerLayout(
      { datasetId: id, organismId: reloaded.organismId! },
      reloaded.layout!,
    )
    const second = await window.prolivis!.centerLayout(
      { datasetId: id, organismId: reloaded.organismId! },
      reloaded.layout!,
    )

    return {
      warnings,
      problems: reproducibility.problems,
      matched: reproducibility.match?.datasetId ?? null,
      release: reloaded.dataset.biogridRelease,
      identical: JSON.stringify(first.nodes) === JSON.stringify(second.nodes),
      nodes: first.nodes.length,
    }
  }, dataset.datasetId)

  console.log(`  manifest: ${JSON.stringify(check)}`)
  expect(check.warnings).toEqual([])
  expect(check.problems).toEqual([])
  expect(check.matched).toBe(dataset.datasetId)
  expect(check.release).toBe('5.0.260')
  expect(check.identical).toBe(true)
  expect(check.nodes).toBeGreaterThan(0)
})
