import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Figure generation for the paper.
 *
 * Every figure is produced by driving the *built* application, from data the reader
 * can obtain themselves, through the same code path the interface uses. Nothing is
 * drawn by hand and nothing is touched up: regenerating a figure means re-running this
 * file, which is the property the 1.0 tool could not offer.
 *
 *   PROLIVIS_FIGURE_SOURCE=~/Downloads/BIOGRID-CORONAVIRUS-5.0.260.tab3.zip \
 *     npx playwright test --config playwright.figures.config.ts
 *
 * Without that variable the bundled 975-record sample is used, so the pipeline is
 * always runnable even without a download.
 */

const here = dirname(fileURLToPath(import.meta.url))
const OUTPUT = resolve(here, '../../../paper/figures')

const SOURCE = process.env['PROLIVIS_FIGURE_SOURCE']
const FIXTURE = {
  name: SOURCE
    ? SOURCE.replace(/^.*\//, '')
    : 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
  mimeType: 'application/zip',
  buffer: readFileSync(
    SOURCE ?? resolve(here, '../fixtures/biogrid-sample.tab3.zip'),
  ),
}

interface FigureSpec {
  readonly slug: string
  readonly caption: string
  readonly organism?: number
  readonly aggregateBelow?: number
  readonly multiMethod?: 'circular-mean' | 'duplicate'
}

/** SARS-CoV-2. The coronavirus set's dominant organism. */
const SARS_COV_2 = 2697049

const FIGURES: FigureSpec[] = [
  {
    slug: 'center-layout-sars-cov-2',
    caption:
      'Center Layout 2.0 for SARS-CoV-2. The organism is at the centre, experimental ' +
      'methods form the inner ring with sector width proportional to their share of ' +
      'the literature, and publications fan outward within their method sector. Node ' +
      'area is proportional to interactions contributed.',
    organism: SARS_COV_2,
  },
  {
    slug: 'center-layout-aggregated',
    caption:
      'The same data with third-level aggregation: methods supported by fewer than ' +
      'five publications collapse into a single node, and the long tail of rarely ' +
      'used assays stops consuming half the circle in unreadable slivers.',
    organism: SARS_COV_2,
    aggregateBelow: 5,
  },
  {
    slug: 'center-layout-duplicated',
    caption:
      'Multi-method publications duplicated into each method sector rather than ' +
      'placed once between them. Each method reads more cleanly in isolation, at the ' +
      'cost of overstating how large the literature is.',
    organism: SARS_COV_2,
    multiMethod: 'duplicate',
  },
  {
    slug: 'center-layout-all-organisms',
    caption:
      'The whole cross-species dataset, spanning SARS-CoV-2, SARS-CoV, MERS and their ' +
      'human hosts. Gene symbols are not unique across these organisms, which is why ' +
      'nodes are keyed by BioGRID gene identifier.',
  },
]

test('generate paper figures', async ({ page }) => {
  test.setTimeout(900_000)
  mkdirSync(OUTPUT, { recursive: true })

  await page.setViewportSize({ width: 1800, height: 1200 })
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())

  const dataset = await page.evaluate(
    async ({ bytes, name }) =>
      window.prolivis!.load(new File([new Uint8Array(bytes)], name)),
    { bytes: [...FIXTURE.buffer], name: FIXTURE.name },
  )
  console.log(
    `  source: ${FIXTURE.name} — ${dataset.recordCount.toLocaleString()} records, ` +
      `${dataset.pairCount.toLocaleString()} interactions, ` +
      `${dataset.publicationCount.toLocaleString()} publications`,
  )

  const manifest: Record<string, unknown>[] = []

  for (const figure of FIGURES) {
    const result = await renderFigure(page, dataset.datasetId, figure)
    writeFileSync(resolve(OUTPUT, `${figure.slug}.svg`), result.svg, 'utf8')
    manifest.push({
      slug: figure.slug,
      caption: figure.caption,
      ...result.stats,
      source: FIXTURE.name,
      biogridRelease: dataset.biogridRelease,
    })
    console.log(
      `  ${figure.slug}: ${result.stats.methods} methods, ` +
        `${result.stats.publications} publications`,
    )
    expect(result.svg.startsWith('<svg')).toBe(true)
  }

  // The manifest is what makes a figure re-derivable: it records the exact query and
  // options behind each one, alongside the release they came from.
  writeFileSync(
    resolve(OUTPUT, 'figures.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )

  // Screenshots of the interface itself, for the README and the paper's tool section.
  await page.evaluate(
    (organismId) => window.prolivis!.ui!.getState().selectOrganism(organismId),
    SARS_COV_2,
  )

  await page.locator('canvas').waitFor()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: resolve(OUTPUT, 'interface.png') })
})

async function renderFigure(page: Page, datasetId: string, figure: FigureSpec) {
  return page.evaluate(
    async ({ datasetId, figure }) => {
      const layout = await window.prolivis!.centerLayout(
        {
          datasetId,
          ...(figure.organism === undefined ? {} : { organismId: figure.organism }),
        },
        {
          ...(figure.aggregateBelow === undefined
            ? {}
            : { aggregateBelow: figure.aggregateBelow }),
          ...(figure.multiMethod === undefined
            ? {}
            : { multiMethod: figure.multiMethod }),
        },
      )
      const scene = window.prolivis!.centerScene(layout, {
        // Labels only help when there is room; a thousand overlapping author names
        // is not information.
        labelPublicationsBelow: 80,
      })
      return {
        svg: window.prolivis!.toSvg(scene, figure.caption.slice(0, 80)),
        stats: {
          methods: layout.nodes.filter(
            (n) => n.kind === 'system' || n.kind === 'aggregate',
          ).length,
          publications: layout.nodes.filter((n) => n.kind === 'publication').length,
          nodes: layout.nodes.length,
          edges: layout.edges.length,
          query: {
            organismId: figure.organism ?? null,
            aggregateBelow: figure.aggregateBelow ?? 0,
            multiMethod: figure.multiMethod ?? 'circular-mean',
          },
        },
      }
    },
    { datasetId, figure },
  )
}
