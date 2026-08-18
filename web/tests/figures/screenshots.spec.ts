import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * The screenshot gallery: the same tool over organisms with very different literatures.
 *
 * One organism's picture proves the thing renders. Six proves the point the tool is
 * making — that a network's shape follows how much it has been studied, so human is a
 * dense core of communities while a barely-studied organism is a thin tree of
 * unreplicated claims, and the same two views say so without being reconfigured.
 *
 *   PROLIVIS_BIG_FIXTURE=~/Downloads/BIOGRID-ALL-5.0.260.tab3.zip \
 *     npx playwright test --config playwright.figures.config.ts screenshots
 */

const here = dirname(fileURLToPath(import.meta.url))
const OUTPUT = resolve(here, '../../../docs/screenshots')
// The full release, and only that: the gallery's point is the contrast between
// organisms, and the counts under each picture are quoted in the README.
const SOURCE = process.env['PROLIVIS_BIG_FIXTURE']

test.skip(!SOURCE, 'set PROLIVIS_BIG_FIXTURE to a full BioGRID release')

/** Matched by name prefix rather than by taxonomy id, so a renamed strain still works. */
const WANTED = [
  { slug: 'human', match: 'Homo sapiens' },
  { slug: 'yeast', match: 'Saccharomyces cerevisiae' },
  { slug: 'fly', match: 'Drosophila melanogaster' },
  { slug: 'mouse', match: 'Mus musculus' },
  { slug: 'arabidopsis', match: 'Arabidopsis thaliana' },
  { slug: 'zebrafish', match: 'Danio rerio' },
]

interface Shot {
  slug: string
  organism: string
  organismId: number
  proteins: number
  interactions: number
  publications: number
  modules: number | null
  grouping: string | null
}

test('shoot the organism gallery', async ({ page }) => {
  test.setTimeout(60 * 60_000)
  mkdirSync(OUTPUT, { recursive: true })

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())
  await page.reload()
  await page.setInputFiles('input[type="file"]', SOURCE!)
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.prolivis!.datasets()))[0]?.recordCount ?? 0,
      { timeout: 40 * 60_000, intervals: [5_000] },
    )
    .toBeGreaterThan(0)

  const dataset = await page.evaluate(async () => (await window.prolivis!.datasets())[0]!)
  const organisms = await page.evaluate(
    (id) => window.prolivis!.organisms(id),
    dataset.datasetId,
  )
  console.log(
    `  source: ${SOURCE!.replace(/^.*\//, '')} — ` +
      `${dataset.recordCount.toLocaleString()} records, ${organisms.length} organisms`,
  )

  // No trust threshold, and modules rather than proteins: both are properties of the
  // view rather than of the organism, so they are set once and every picture is
  // comparable with every other.
  await page.evaluate(() =>
    window.prolivis!.ui!.getState().updateNetwork({ minTrust: 0, grouping: 'modules' }),
  )

  const shots: Shot[] = []
  for (const wanted of WANTED) {
    const organism = organisms.find((o) => o.name.startsWith(wanted.match))
    if (!organism) {
      console.log(`  ${wanted.slug}: not in this release, skipped`)
      continue
    }

    // The literature: who reported this organism's interactions, with which method.
    await page.evaluate(() => window.prolivis!.ui!.getState().setView('center'))
    await page.evaluate(
      (id) => window.prolivis!.ui!.getState().selectOrganism(id),
      organism.organismId,
    )
    await settled(page, () => page.evaluate(() => window.prolivis!.ui!.getState().layout !== null))
    await page.screenshot({ path: resolve(OUTPUT, `${wanted.slug}-literature.png`) })

    // The interactions, read one level up.
    await page.evaluate(() => window.prolivis!.ui!.getState().setView('network'))
    await settled(page, () =>
      page.evaluate(() => {
        const state = window.prolivis!.ui!.getState()
        return state.highLevel !== null || state.network !== null
      }),
    )
    await page.screenshot({ path: resolve(OUTPUT, `${wanted.slug}-modules.png`) })

    const stats = await page.evaluate(() => {
      const state = window.prolivis!.ui!.getState()
      return {
        proteins: state.networkStats?.nodes ?? 0,
        interactions: state.networkStats?.edges ?? 0,
        publications: state.layout?.nodes.filter((n) => n.kind === 'publication').length ?? 0,
        modules: state.highLevel?.nodes.length ?? null,
      }
    })
    const grouping = await page.evaluate(async (id) => {
      const state = window.prolivis!.ui!.getState()
      if (state.highLevel === null) return null
      const scored = await window.prolivis!.score({
        datasetId: state.activeDatasetId!,
        organismId: id,
        physicalOnly: true,
        excludeSelfInteractions: true,
      })
      return window.prolivis!.autoContract(window.prolivis!.graphFrom(scored)).strategy
    }, organism.organismId)

    shots.push({
      slug: wanted.slug,
      organism: organism.name,
      organismId: organism.organismId,
      grouping,
      ...stats,
    })
    console.log(
      `  ${wanted.slug}: ${organism.name} — ${stats.proteins.toLocaleString()} proteins, ` +
        `${stats.interactions.toLocaleString()} interactions, ` +
        `${stats.publications.toLocaleString()} publications` +
        (stats.modules === null ? ' (drawn as proteins)' : `, ${stats.modules} modules`),
    )
  }

  writeFileSync(
    resolve(OUTPUT, 'gallery.json'),
    `${JSON.stringify(
      { source: SOURCE!.replace(/^.*\//, ''), release: dataset.biogridRelease, shots },
      null,
      2,
    )}\n`,
    'utf8',
  )

  expect(shots.length).toBeGreaterThan(3)
})

/** Wait for a rebuild to finish, then let the canvas paint. */
async function settled(page: Page, ready: () => Promise<boolean>) {
  await expect.poll(ready, { timeout: 15 * 60_000, intervals: [1_000] }).toBe(true)
  await expect
    .poll(() => page.evaluate(() => window.prolivis!.ui!.getState().busy === null), {
      timeout: 15 * 60_000,
      intervals: [1_000],
    })
    .toBe(true)
  await page.waitForTimeout(1200)
}
