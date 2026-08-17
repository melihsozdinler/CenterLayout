import { statSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/**
 * Scalability against a real BioGRID release.
 *
 * Skipped unless `PROLIVIS_BIG_FIXTURE` points at a `BIOGRID-*.tab3.zip`, because the
 * dumps are far too large to check in. This is the test that substantiates the claim
 * that a full release can be worked on in a browser — the fixture suite runs on 975
 * records, which proves correctness and says nothing about scale.
 *
 *   PROLIVIS_BIG_FIXTURE=~/Downloads/BIOGRID-ALL-LATEST.tab3.zip \
 *     npx playwright test scale
 *
 * The file is handed to the page through the file input rather than through
 * `page.evaluate`. Passing 181 MB as an array of byte values over the debugging
 * protocol takes gigabytes and minutes; the input is what a user touches anyway.
 */

const FIXTURE_PATH = process.env['PROLIVIS_BIG_FIXTURE']

test.describe.configure({ mode: 'serial' })

test.skip(!FIXTURE_PATH, 'set PROLIVIS_BIG_FIXTURE to a BioGRID tab3 zip to run')

test('ingests a full BioGRID release and stays usable', async ({ page }) => {
  // A full release is minutes of work, not seconds.
  test.setTimeout(45 * 60_000)

  const path = FIXTURE_PATH!
  const name = path.replace(/^.*\//, '')
  const zipMb = statSync(path).size / 1e6

  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())

  const heap = () =>
    page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    )

  const started = Date.now()
  await page.setInputFiles('input[type="file"]', path)

  // Wait for a signal that means *finished*, not one that merely means *started*.
  // `record_count` on the dataset row is written once, at the end of ingest; the
  // progress text and the canvas both appear long before that.
  let progress = ''
  await expect
    .poll(
      async () => {
        const [state, sidebar] = await Promise.all([
          page.evaluate(async () => {
            const rows = await window.prolivis!.sql<{ n: number; loaded: number }>(
              `SELECT (SELECT count(*) FROM interactions)::BIGINT AS n,
                      (SELECT coalesce(max(record_count), 0) FROM datasets)::BIGINT AS loaded`,
            )
            return { rows: Number(rows[0]?.n ?? 0), loaded: Number(rows[0]?.loaded ?? 0) }
          }),
          page.locator('.app-sidebar').textContent(),
        ])
        const note = (sidebar ?? '').match(/Loaded ([\d,]+) records|Creating indexes|Building gene/)
        const line =
          `  … ${state.rows.toLocaleString()} rows in the database` +
          (note ? ` (${note[0]})` : '')
        if (line !== progress) {
          progress = line
          console.log(line)
        }
        return state.loaded > 0 ? 'done' : 'loading'
      },
      { timeout: 40 * 60_000, intervals: [10_000] },
    )
    .toBe('done')

  const ingestSeconds = (Date.now() - started) / 1000
  const afterIngestHeap = await heap()

  const dataset = await page.evaluate(async () => (await window.prolivis!.datasets())[0]!)
  console.log(
    `\n  ${name}: ${zipMb.toFixed(0)} MB zip\n` +
      `  ${dataset.recordCount.toLocaleString()} records, ` +
      `${dataset.pairCount.toLocaleString()} interactions, ` +
      `${dataset.publicationCount.toLocaleString()} publications, ` +
      `${dataset.geneCount.toLocaleString()} genes, ` +
      `${dataset.organismCount.toLocaleString()} organisms\n` +
      `  ingest ${ingestSeconds.toFixed(0)}s, JS heap ${(afterIngestHeap / 1e6).toFixed(0)} MB`,
  )

  expect(dataset.recordCount).toBeGreaterThan(1_000_000)

  // Ingest is worth little if the result is then unusable, so time the queries the
  // interface actually runs.
  // Human is the largest single organism in the release and the realistic worst case.
  const HUMAN = 9606

  const measured = await page.evaluate(async (id) => {
    const timings: Record<string, number> = {}
    const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = performance.now()
      const value = await fn()
      timings[label] = Math.round(performance.now() - t0)
      return value
    }
    const heapMb = () =>
      Math.round(
        ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0) / 1e6,
      )

    const organisms = await time('organisms', () => window.prolivis!.organisms(id))
    const systems = await time('systems', () => window.prolivis!.systems(id))
    const layout = await time('centreLayout', () =>
      window.prolivis!.centerLayout({ datasetId: id, organismId: 9606 }),
    )
    const scored = await time('score', () =>
      window.prolivis!.score({ datasetId: id, organismId: 9606 }),
    )
    const heapAfterScore = heapMb()
    const graph = await time('graph', () =>
      window.prolivis!.graph({ datasetId: id, organismId: 9606 }, { minScore: 0.3 }),
    )
    const cliques = await time('cliques', async () =>
      window.prolivis!.cliques(graph.reduce({ minDegree: 3 }), {
        minSize: 4,
        maxCliques: 5000,
      }),
    )

    return {
      timings,
      organisms: organisms.length,
      systems: systems.length,
      layoutNodes: layout.nodes.length,
      scored: scored.length,
      graph: { nodes: graph.order, edges: graph.size },
      cliques: cliques.cliques.length,
      largestClique: cliques.cliques[0]?.length ?? 0,
      heapAfterScore,
      heapPeak: heapMb(),
    }
  }, dataset.datasetId)

  console.log(
    `  organism list        ${measured.timings['organisms']} ms  (${measured.organisms} organisms)\n` +
      `  experimental systems ${measured.timings['systems']} ms  (${measured.systems} systems)\n` +
      `  centre layout human  ${measured.timings['centreLayout']} ms  (${measured.layoutNodes.toLocaleString()} nodes)\n` +
      `  trust scoring human  ${measured.timings['score']} ms  (${measured.scored.toLocaleString()} interactions)\n` +
      `  graph at trust 0.3   ${measured.timings['graph']} ms  (${measured.graph.nodes.toLocaleString()} proteins, ${measured.graph.edges.toLocaleString()} interactions)\n` +
      `  maximal cliques      ${measured.timings['cliques']} ms  (${measured.cliques} cliques, largest ${measured.largestClique})\n` +
      `  JS heap after scoring ${measured.heapAfterScore} MB, peak ${measured.heapPeak} MB\n`,
  )

  // BIOGRID-ALL 5.0.260 carries 98 organisms; the assertion is a floor, not a guess.
  expect(measured.organisms).toBeGreaterThan(50)
  expect(measured.systems).toBeGreaterThan(20)
  expect(measured.scored).toBeGreaterThan(100_000)

  // Interactivity is the claim under test; a minute-long query is a different tool.
  expect(measured.timings['organisms']).toBeLessThan(30_000)
  expect(measured.timings['systems']).toBeLessThan(30_000)
  expect(HUMAN).toBe(9606)

  await readOneLevelUp(page, dataset.datasetId)
})

/**
 * The high-level view at organism scale — the case it exists for.
 *
 * Runs on the dataset the previous test ingested, so it is part of the same serial run.
 * A contraction that is only ever exercised on a fixture of 975 records proves nothing
 * about the hairball it claims to solve.
 */
async function readOneLevelUp(page: Page, datasetId: string) {
  const measured = await page.evaluate(async (id) => {
    const time = async <T>(fn: () => Promise<T> | T): Promise<[T, number]> => {
      const t0 = performance.now()
      const value = await fn()
      return [value, Math.round(performance.now() - t0)]
    }

    const [scored, scoreMs] = await time(() =>
      window.prolivis!.score({
        datasetId: id,
        organismId: 9606,
        physicalOnly: true,
        excludeSelfInteractions: true,
      }),
    )
    // The honest worst case: everything reported, no trust threshold hiding the tail.
    const [graph, graphMs] = await time(() => window.prolivis!.graphFrom(scored))

    const levels: {
      order: number
      size: number
      modules: number
      largest: number
      strategy: string
      contractMs: number
      layoutMs: number
    }[] = []

    let current = graph
    for (let depth = 0; depth < 6 && current.order > 240; depth += 1) {
      const [high, contractMs] = await time(() => window.prolivis!.autoContract(current))
      const [, layoutMs] = await time(() => window.prolivis!.highLevelLayout(high))
      const biggest = [...high.nodes].sort((a, b) => b.size - a.size)[0]!
      levels.push({
        order: current.order,
        size: current.size,
        modules: high.nodes.length,
        largest: biggest.size,
        strategy: high.strategy,
        contractMs,
        layoutMs,
      })

      const keep = new Set<number>()
      for (const member of biggest.members) {
        const index = current.index(member)
        if (index !== undefined) keep.add(index)
      }
      if (keep.size === 0 || keep.size === current.order) break
      current = current.induced(keep)
    }

    return {
      scoreMs,
      graphMs,
      interactions: scored.length,
      order: graph.order,
      size: graph.size,
      levels,
      leaf: current.order,
    }
  }, datasetId)

  console.log(
    `\n  human interactome: ${measured.order.toLocaleString()} proteins, ` +
      `${measured.size.toLocaleString()} interactions ` +
      `(scored in ${(measured.scoreMs / 1000).toFixed(1)}s, graph in ${(measured.graphMs / 1000).toFixed(1)}s)`,
  )
  for (const [depth, level] of measured.levels.entries()) {
    console.log(
      `  level ${depth}: ${level.order.toLocaleString()} proteins → ` +
        `${level.modules} ${level.strategy === 'communities' ? 'communities' : 'modules'}, ` +
        `largest ${level.largest.toLocaleString()} ` +
        `(contract ${(level.contractMs / 1000).toFixed(1)}s, layout ${(level.layoutMs / 1000).toFixed(1)}s)`,
    )
  }
  console.log(`  reached ${measured.leaf.toLocaleString()} proteins — drawable as proteins\n`)

  // The whole claim, stated as assertions.
  expect(measured.levels.length).toBeGreaterThan(1)
  for (const level of measured.levels) {
    // Readable: a hairball of modules would be no better than a hairball of proteins.
    expect(level.modules).toBeLessThanOrEqual(60)
    expect(level.modules).toBeGreaterThan(1)
    // Progress: each level is strictly smaller, which is what makes the descent end.
    expect(level.largest).toBeLessThan(level.order)
    // Interactive: contracting a hundred thousand interactions has to feel like a click.
    expect(level.contractMs).toBeLessThan(30_000)
  }
  for (let i = 1; i < measured.levels.length; i += 1) {
    expect(measured.levels[i]!.order).toBeLessThan(measured.levels[i - 1]!.order)
  }
  expect(measured.leaf).toBeLessThanOrEqual(240)
}
