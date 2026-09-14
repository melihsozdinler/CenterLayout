import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * The trust model against real BioGRID data.
 *
 * Unit tests pin the mathematics; this pins the behaviour that matters to a user —
 * that the ranking it produces over a real release is sane, that re-weighting is
 * cheap, and that the model degrades honestly when the literature is unenriched.
 */

const FIXTURE = fileURLToPath(
  new URL('../fixtures/biogrid-sample.tab3.zip', import.meta.url),
)
const FIXTURE_BYTES = [...readFileSync(FIXTURE)]

const sql = <T,>(page: Page, query: string) =>
  page.evaluate((q) => window.prolivis!.sql(q), query) as Promise<T[]>

async function loadFixture(page: Page) {
  return page.evaluate(async (bytes) => {
    const file = new File(
      [new Uint8Array(bytes)],
      'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
    )
    return window.prolivis!.load(file)
  }, FIXTURE_BYTES)
}

/** Give every publication citations and a distinct institution, without a network. */
async function fakeEnrichment(page: Page, options: { labs?: number } = {}) {
  const labs = options.labs ?? 50
  await page.evaluate(async (labCount) => {
    const pubs = await window.prolivis!.sql<{ publication_key: string; year: number }>(
      `SELECT DISTINCT publication_key, year FROM publications`,
    )
    const values = pubs
      .map((p, i) => {
        const key = p.publication_key.replace(/'/g, "''")
        const citations = (i % 20) * 25
        const year = p.year ?? 2015
        return (
          `('${key}', 'openalex', NULL, NULL, NULL, NULL, 'Journal', ${year}, ` +
          `${citations}, TRUE, 'article', NULL, 3, 'ror-${i % labCount}', 'Lab ${i % labCount}', ` +
          `now(), TRUE)`
        )
      })
      .join(',')
    if (values) await window.prolivis!.sql(`INSERT OR REPLACE INTO literature VALUES ${values}`)
  }, labs)
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await window.prolivis!.wipe()
    await window.prolivis!.sql('DELETE FROM literature')
  })
})

test('scores every pair in a real dataset, in [0, 1]', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const scored = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }),
    dataset.datasetId,
  )

  expect(scored).toHaveLength(dataset.pairCount)
  for (const pair of scored) {
    expect(pair.score).toBeGreaterThanOrEqual(0)
    expect(pair.score).toBeLessThanOrEqual(1)
    expect(pair.coverage).toBeGreaterThan(0)
  }
})

test('ranks well-replicated interactions above single-record ones', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)
  await fakeEnrichment(page)

  const scored = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }),
    dataset.datasetId,
  )

  const evidence = await sql<{ pair_key: string; publication_count: number }>(
    page,
    `SELECT pair_key, publication_count::INTEGER AS publication_count FROM ppi_pairs`,
  )
  const publications = new Map(
    evidence.map((e) => [e.pair_key, Number(e.publication_count)]),
  )

  const multi = scored.filter((p) => (publications.get(p.pairKey) ?? 0) > 1)
  const single = scored.filter((p) => (publications.get(p.pairKey) ?? 0) === 1)
  expect(multi.length).toBeGreaterThan(0)
  expect(single.length).toBeGreaterThan(0)

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  expect(mean(multi.map((p) => p.score))).toBeGreaterThan(
    mean(single.map((p) => p.score)),
  )
})

test('reports every term so a score can be explained', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)
  await fakeEnrichment(page)

  const scored = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }),
    dataset.datasetId,
  )
  const best = [...scored].sort((a, b) => b.score - a.score)[0]!

  const terms = await page.evaluate(() => window.prolivis!.trustTerms())
  for (const description of terms) {
    expect(best.terms).toHaveProperty(description.term)
  }
  // The top-scoring pair should be informed on the evidence-side terms at least.
  expect(best.terms.replication).not.toBeNull()
  expect(best.terms.methodWeight).not.toBeNull()
})

test('degrades honestly without enrichment: lower coverage, not a wrong score', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  // No literature rows at all.
  const bare = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }, 'literature-aware'),
    dataset.datasetId,
  )
  expect(bare.every((p) => p.terms.literatureImpact === null)).toBe(true)
  expect(bare.every((p) => p.coverage < 1)).toBe(true)
  // Still a usable score from the evidence that *is* known.
  expect(bare.every((p) => p.score >= 0 && p.score <= 1)).toBe(true)

  await fakeEnrichment(page)
  const enriched = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }, 'literature-aware'),
    dataset.datasetId,
  )
  expect(enriched.every((p) => p.coverage === 1)).toBe(true)
})

test('offline preset gives full coverage with no literature at all', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const scored = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }, 'evidence-only'),
    dataset.datasetId,
  )
  // evidence-only asks nothing of the literature, except independence, which falls
  // back to BioGRID's own author labels.
  expect(scored.every((p) => p.coverage === 1)).toBe(true)
})

test('presets disagree, and structural-strict makes directness drive the ranking', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)
  await fakeEnrichment(page)

  // Gathering and re-scoring both happen in the page: `GatheredEvidence` holds a Map,
  // which does not survive the test harness's serialization boundary, and in the app
  // it never crosses one.
  const { strict, offline } = await page.evaluate(async (id) => {
    const g = await window.prolivis!.gather({ datasetId: id })
    return {
      strict: window.prolivis!.rescore(g, 'structural-strict'),
      offline: window.prolivis!.rescore(g, 'evidence-only'),
    }
  }, dataset.datasetId)

  const byKey = (list: typeof strict) => new Map(list.map((p) => [p.pairKey, p.score]))
  const strictScores = byKey(strict)
  const offlineScores = byKey(offline)

  // The two configurations must not produce identical rankings, or the presets are
  // decorative.
  const differing = [...strictScores].filter(
    ([k, v]) => Math.abs(v - (offlineScores.get(k) ?? 0)) > 1e-9,
  )
  expect(differing.length).toBeGreaterThan(0)

  // The claim structural-strict makes is that assay directness drives the ranking.
  // Testing it on two cherry-picked pairs confounds directness with everything else
  // those pairs happen to have — the co-crystal pair is also the well-replicated one.
  // Measured properly, across every pair: score should track directness more closely
  // under structural-strict than under evidence-only.
  const correlation = (list: typeof strict) => {
    const xs = list.map((p) => p.terms.methodWeight ?? 0)
    const ys = list.map((p) => p.score)
    const n = xs.length
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < n; i += 1) {
      const a = xs[i]! - mx
      const b = ys[i]! - my
      num += a * b
      dx += a * a
      dy += b * b
    }
    return num / Math.sqrt(dx * dy)
  }

  const strictCorrelation = correlation(strict)
  const offlineCorrelation = correlation(offline)
  console.log(
    `  score-vs-directness correlation: structural-strict ` +
      `${strictCorrelation.toFixed(3)}, evidence-only ${offlineCorrelation.toFixed(3)}`,
  )
  expect(strictCorrelation).toBeGreaterThan(offlineCorrelation)
})

test('re-weighting gathered evidence needs no further database work', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)
  await fakeEnrichment(page)

  const timings = await page.evaluate(async (id) => {
    const gatherStart = performance.now()
    const gathered = await window.prolivis!.gather({ datasetId: id })
    const gatherMs = performance.now() - gatherStart

    const rescoreStart = performance.now()
    for (const preset of ['literature-aware', 'evidence-only', 'structural-strict']) {
      window.prolivis!.rescore(gathered, preset)
    }
    const rescoreMs = (performance.now() - rescoreStart) / 3

    return { gatherMs, rescoreMs, pairs: gathered.evidence.length }
  }, dataset.datasetId)

  console.log(
    `  gather ${timings.gatherMs.toFixed(0)} ms, ` +
      `re-score ${timings.rescoreMs.toFixed(1)} ms for ${timings.pairs} pairs`,
  )
  // Re-weighting must be interactive: this is what lets a slider re-colour a network.
  expect(timings.rescoreMs).toBeLessThan(200)
})

test('separates genetic-only evidence from physical claims', async ({ page }) => {
  test.setTimeout(240_000)
  const dataset = await loadFixture(page)

  const scored = await page.evaluate(
    (id) => window.prolivis!.score({ datasetId: id }),
    dataset.datasetId,
  )
  const genetic = scored.filter((p) => p.evidenceType === 'genetic')
  expect(genetic.length).toBeGreaterThan(0)

  // Genetic assays say nothing about physical contact, so directness must be zero.
  for (const pair of genetic) expect(pair.terms.methodWeight).toBe(0)
})

test('calibrates and ablates against a supplied reference set', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)
  await fakeEnrichment(page)

  // Build a reference set from the data itself: pairs with the most publications are
  // "positives", singletons "negatives". This is circular as science but exact as a
  // test that the machinery reports what it should.
  const reference = await sql<{ symbol_lo: string; symbol_hi: string; n: number }>(
    page,
    `SELECT symbol_lo, symbol_hi, publication_count::INTEGER AS n FROM ppi_pairs
      WHERE symbol_lo IS NOT NULL AND symbol_hi IS NOT NULL
      ORDER BY publication_count DESC LIMIT 40`,
  )
  const positives = reference.filter((r) => Number(r.n) > 1)
  const negatives = reference.filter((r) => Number(r.n) === 1)
  expect(positives.length).toBeGreaterThan(0)

  const text = [
    ...positives.map((r) => `${r.symbol_lo},${r.symbol_hi},+`),
    ...negatives.map((r) => `${r.symbol_lo},${r.symbol_hi},-`),
  ].join('\n')

  const result = await page.evaluate(
    async ({ id, text }) => {
      const set = window.prolivis!.referenceSet('self-consistency', text)
      const gathered = await window.prolivis!.gather({ datasetId: id })
      const scored = window.prolivis!.rescore(gathered)
      return {
        calibration: window.prolivis!.calibrate(scored, set),
        ablation: window.prolivis!.ablate(gathered, set),
      }
    },
    { id: dataset.datasetId, text },
  )

  console.log(
    `  AUROC ${result.calibration.auroc.toFixed(3)} over ` +
      `${result.calibration.positives}+/${result.calibration.negatives}- pairs`,
  )
  // At least as many as we labelled: a symbol-keyed reference set can match more
  // than one gene-id pair, because symbols are not unique across organisms — the same
  // collision (E, M, N in three coronavirus species) that makes gene ids the node key.
  expect(result.calibration.positives).toBeGreaterThanOrEqual(positives.length)
  expect(result.calibration.auroc).toBeGreaterThan(0.5)
  expect(result.calibration.roc.length).toBeGreaterThan(1)

  // The ablation must report the full model plus one row per weighted term.
  expect(result.ablation[0]!.removed).toBeNull()
  expect(result.ablation.length).toBeGreaterThan(1)
  console.log(
    `  ablation: ${result.ablation
      .filter((r) => r.removed)
      .map((r) => `${r.removed} ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)}`)
      .join(', ')}`,
  )
})
