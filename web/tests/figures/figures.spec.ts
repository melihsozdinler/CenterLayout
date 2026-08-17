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
 *
 * The high-level figures below take a second source, because the view they show only
 * has something to show on a network too large to draw:
 *
 *   PROLIVIS_BIG_FIXTURE=~/Downloads/BIOGRID-ALL-5.0.260.tab3.zip
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

  // The evaluation section's numbers, measured rather than transcribed. A paper that
  // quotes a figure someone once ran acquires numbers that were true once; these are
  // regenerated with the figures, from the same release, and the manuscript inputs
  // them as macros.
  const evaluation = await measureEvidence(page, dataset.datasetId)
  writeFileSync(
    resolve(OUTPUT, 'evaluation.json'),
    `${JSON.stringify({ source: FIXTURE.name, release: dataset.biogridRelease, ...evaluation }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(resolve(OUTPUT, 'numbers.tex'), numberMacros(evaluation), 'utf8')
  console.log(
    `  SARS-CoV-2: ${evaluation.proteins.toLocaleString()} proteins, ` +
      `${evaluation.interactions.toLocaleString()} interactions, ` +
      `${evaluation.bridges.toLocaleString()} bridges; ` +
      `at trust 0.2, ${evaluation.thresholdInteractions.toLocaleString()} remain`,
  )
  console.log(
    `  directness correlation: strict ${evaluation.corrStrict.toFixed(3)}, ` +
      `evidence-only ${evaluation.corrEvidence.toFixed(3)}`,
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

// --- the high-level view ------------------------------------------------------

/**
 * The modules view, its drill-down, and the table of the descent.
 *
 * Uses `PROLIVIS_BIG_FIXTURE` when it is set, because a view whose subject is a network
 * too large to draw cannot be demonstrated on 975 records; the coronavirus release
 * falls back to something real but small. The file is handed to the page through the
 * file input rather than through `page.evaluate` — 181 MB as an array of byte values
 * over the debugging protocol takes gigabytes and minutes.
 */
const BIG = process.env['PROLIVIS_BIG_FIXTURE']

interface DescentLevel {
  readonly order: number
  readonly size: number
  readonly modules: number
  readonly largest: number
  readonly strategy: string
  readonly seconds: number
}

test('generate high-level figures', async ({ page }) => {
  test.setTimeout(30 * 60_000)
  mkdirSync(OUTPUT, { recursive: true })

  await page.setViewportSize({ width: 1800, height: 1200 })
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())
  await page.reload()

  const source = BIG ?? SOURCE ?? resolve(here, '../fixtures/biogrid-sample.tab3.zip')
  await page.setInputFiles('input[type="file"]', source)
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.prolivis!.datasets()))[0]?.recordCount ?? 0,
      { timeout: 25 * 60_000, intervals: [5_000] },
    )
    .toBeGreaterThan(0)

  const dataset = await page.evaluate(async () => (await window.prolivis!.datasets())[0]!)
  // The dataset's dominant organism: human in a full release, SARS-CoV-2 in the
  // coronavirus one. Choosing it by size rather than by number keeps this honest
  // whichever source the reader has.
  const organism = await page.evaluate(
    async (id) => (await window.prolivis!.organisms(id))[0]!,
    dataset.datasetId,
  )
  console.log(
    `  source: ${source.replace(/^.*\//, '')} — ` +
      `${dataset.recordCount.toLocaleString()} records; ` +
      `figures for ${organism.name}`,
  )

  // No trust threshold: the figure should show the network as reported, since hiding
  // the weak half would be doing the reader's filtering for them.
  await page.evaluate((organismId) => {
    const state = window.prolivis!.ui!.getState()
    return state.selectOrganism(organismId)
  }, organism.organismId)
  await page.evaluate(() =>
    window.prolivis!.ui!.getState().updateNetwork({ minTrust: 0, grouping: 'modules' }),
  )
  await page.evaluate(() => window.prolivis!.ui!.getState().setView('network'))

  await expect
    .poll(
      () => page.evaluate(() => window.prolivis!.ui!.getState().highLevel !== null),
      { timeout: 10 * 60_000, intervals: [2_000] },
    )
    .toBe(true)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: resolve(OUTPUT, 'interface-modules.png') })
  writeFileSync(resolve(OUTPUT, 'high-level.svg'), await highLevelSvg(page), 'utf8')

  const top = await page.evaluate(() => {
    const { highLevel, networkStats } = window.prolivis!.ui!.getState()
    const biggest = [...highLevel!.nodes].sort((a, b) => b.size - a.size)[0]!
    return {
      id: biggest.id,
      label: biggest.label,
      size: biggest.size,
      modules: highLevel!.nodes.length,
      proteins: networkStats?.nodes ?? 0,
      interactions: networkStats?.edges ?? 0,
    }
  })
  console.log(
    `  level 0: ${top.proteins.toLocaleString()} proteins, ` +
      `${top.interactions.toLocaleString()} interactions → ${top.modules} modules ` +
      `(largest ${top.label}, ${top.size.toLocaleString()})`,
  )

  // Open the largest module: the drill-down is the point of the view, and a figure of
  // the top level alone would not show that it exists.
  await page.evaluate((id) => window.prolivis!.ui!.getState().drillInto(id), top.id)
  await expect
    .poll(() => page.evaluate(() => window.prolivis!.ui!.getState().drill.length), {
      timeout: 10 * 60_000,
      intervals: [2_000],
    })
    .toBe(1)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: resolve(OUTPUT, 'interface-modules-drill.png') })

  const drilled = await page.evaluate(() => window.prolivis!.ui!.getState().highLevel)
  if (drilled) {
    writeFileSync(resolve(OUTPUT, 'high-level-drill.svg'), await highLevelSvg(page), 'utf8')
  }

  // The descent itself, measured rather than described.
  const descent = await measureDescent(page, dataset.datasetId, organism.organismId)
  for (const [depth, level] of descent.entries()) {
    console.log(
      `  level ${depth}: ${level.order.toLocaleString()} proteins → ${level.modules} ` +
        `${level.strategy === 'communities' ? 'communities' : 'modules'}, ` +
        `largest ${level.largest.toLocaleString()} (${level.seconds.toFixed(1)}s)`,
    )
  }

  writeFileSync(
    resolve(OUTPUT, 'drilldown.json'),
    `${JSON.stringify(
      {
        source: source.replace(/^.*\//, ''),
        biogridRelease: dataset.biogridRelease,
        organism: organism.name,
        minTrust: 0,
        levels: descent,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(resolve(OUTPUT, 'drilldown.tex'), descentTable(descent), 'utf8')

  // Which grouping each organism's network actually needs. This is a result rather
  // than a detail: it says how often the structural decomposition is the right level
  // to read a PPI network at, and the answer is "when nobody has studied it much yet".
  const groupings = await surveyGroupings(page, dataset.datasetId)
  const structural = groupings.filter((g) => g.strategy === 'biconnected-components')
  console.log(
    `  grouping survey: ${structural.length} of ${groupings.length} organisms ` +
      `(>= 100 proteins) decompose structurally — ` +
      structural
        .slice(0, 4)
        .map((g) => `${g.organism} ${g.proteins}p/${g.interactions}i`)
        .join(', '),
  )

  writeFileSync(
    resolve(OUTPUT, 'groupings.json'),
    `${JSON.stringify({ source: source.replace(/^.*\//, ''), release: dataset.biogridRelease, organisms: groupings }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(
    resolve(OUTPUT, 'numbers-all.tex'),
    [
      '% Generated by tests/figures/figures.spec.ts. Do not edit.',
      `\\newcommand{\\HumanProteins}{${tex(descent[0]?.order ?? 0)}}`,
      `\\newcommand{\\HumanInteractions}{${tex(descent[0]?.size ?? 0)}}`,
      `\\newcommand{\\HumanModules}{${descent[0]?.modules ?? 0}}`,
      `\\newcommand{\\HumanSteps}{${descent.length}}`,
      `\\newcommand{\\HumanLeaf}{${tex(descent[descent.length - 1]?.largest ?? 0)}}`,
      `\\newcommand{\\HumanDescentSeconds}{${descent
        .reduce((sum, level) => sum + level.seconds, 0)
        .toFixed(1)}}`,
      `\\newcommand{\\OrganismsSurveyed}{${groupings.length}}`,
      `\\newcommand{\\OrganismsStructural}{${structural.length}}`,
      '',
    ].join('\n'),
    'utf8',
  )

  expect(descent.length).toBeGreaterThan(0)
  expect(top.modules).toBeGreaterThan(1)
})

/** Thousands separators LaTeX will not break across a line. */
function tex(value: number): string {
  return value.toLocaleString('en-US').replace(/,/g, '{,}')
}

/**
 * Which grouping each organism's network needs, over the organisms large enough for
 * the question to mean anything.
 */
async function surveyGroupings(page: Page, datasetId: string) {
  return page.evaluate(async (id) => {
    const organisms = await window.prolivis!.organisms(id)
    const rows: {
      organism: string
      proteins: number
      interactions: number
      strategy: string
      modules: number
    }[] = []

    for (const organism of organisms) {
      const scored = await window.prolivis!.score({
        datasetId: id,
        organismId: organism.organismId,
        physicalOnly: true,
        excludeSelfInteractions: true,
      })
      const graph = window.prolivis!.graphFrom(scored)
      // Below a hundred proteins the network is drawn as proteins anyway, so which
      // grouping it would have used is not a question anyone asks.
      if (graph.order < 100) continue
      const high = window.prolivis!.autoContract(graph)
      rows.push({
        organism: organism.name,
        proteins: graph.order,
        interactions: graph.size,
        strategy: high.strategy,
        modules: high.nodes.length,
      })
      if (rows.length >= 45) break
    }
    return rows
  }, datasetId)
}

/** The contracted graph on screen, as SVG, through the same scene the canvas paints. */
async function highLevelSvg(page: Page): Promise<string> {
  return page.evaluate(() => {
    const { highLevel, drill } = window.prolivis!.ui!.getState()
    const scene = window.prolivis!.highLevelScene(highLevel!)
    const where = drill.length === 0 ? 'whole network' : drill[drill.length - 1]!.label
    return window.prolivis!.toSvg(scene, `High-level graph — ${where}`)
  })
}

/** Contract, take the largest module, contract that, until a level is drawable. */
async function measureDescent(
  page: Page,
  datasetId: string,
  organismId: number,
): Promise<DescentLevel[]> {
  return page.evaluate(
    async ({ datasetId, organismId }) => {
      const scored = await window.prolivis!.score({
        datasetId,
        organismId,
        physicalOnly: true,
        excludeSelfInteractions: true,
      })
      let graph = window.prolivis!.graphFrom(scored)

      const levels = []
      for (let depth = 0; depth < 8 && graph.order > 240; depth += 1) {
        const started = performance.now()
        const high = window.prolivis!.autoContract(graph)
        const seconds = (performance.now() - started) / 1000
        const biggest = [...high.nodes].sort((a, b) => b.size - a.size)[0]!
        levels.push({
          order: graph.order,
          size: graph.size,
          modules: high.nodes.length,
          largest: biggest.size,
          strategy: high.strategy,
          seconds,
        })

        const keep = new Set<number>()
        for (const member of biggest.members) {
          const index = graph.index(member)
          if (index !== undefined) keep.add(index)
        }
        if (keep.size === 0 || keep.size === graph.order) break
        graph = graph.induced(keep)
      }
      return levels
    },
    { datasetId, organismId },
  )
}

/**
 * The descent as a complete LaTeX tabular, so the manuscript inputs measured numbers
 * rather than transcribed ones. Transcription is where papers acquire numbers that were
 * true once.
 *
 * The whole tabular rather than its body: a file whose last line ends a row cannot be
 * `\\input` from inside an alignment --- TeX reports a misplaced `\\noalign` on the
 * following rule.
 */
function descentTable(levels: readonly DescentLevel[]): string {
  const rows = levels.map((level, depth) => {
    const grouping =
      level.strategy === 'communities' ? 'communities' : 'biconnected components'
    return (
      `  ${depth} & ${tex(level.order)} & ${tex(level.size)} & ${grouping} & ` +
      `${level.modules} & ${tex(level.largest)} & ${level.seconds.toFixed(1)} \\\\`
    )
  })
  const last = levels[levels.length - 1]

  return [
    '% Generated by tests/figures/figures.spec.ts. Do not edit.',
    '\\begin{tabular}{rrrlrrr}',
    '  \\toprule',
    '  Level & Proteins & Interactions & Grouping & Modules & Largest & Time (s) \\\\',
    '  \\midrule',
    ...rows,
    '  \\bottomrule',
    '\\end{tabular}',
    last
      ? `\n\\medskip\n\\footnotesize After the last step, ${tex(last.largest)} proteins ` +
        'remain, which is drawn protein by protein.'
      : '',
    '',
  ].join('\n')
}

// --- the evaluation section's numbers ----------------------------------------

/** SARS-CoV-2, as the evaluation section reports it. */
async function measureEvidence(page: Page, datasetId: string) {
  return page.evaluate(async (id) => {
    const query = {
      datasetId: id,
      organismId: 2697049,
      physicalOnly: true,
      excludeSelfInteractions: true,
    }
    const scored = await window.prolivis!.score(query)
    const graph = window.prolivis!.graphFrom(scored)
    const structure = window.prolivis!.modules(graph)
    const components = window.prolivis!.components(graph).members.length

    const THRESHOLD = 0.2
    const thresholded = window.prolivis!.graphFrom(
      scored.filter((p) => p.score >= THRESHOLD),
    )

    // How much of the reported network rests on exactly one publication — the claim
    // the abstract makes, so it had better be measured.
    const support = await window.prolivis!.sql<{ single: number; total: number }>(
      `SELECT count(*) FILTER (WHERE publication_count = 1)::INTEGER AS single,
              count(*)::INTEGER                                     AS total
         FROM ppi_pairs
        WHERE dataset_id = '${id}'
          AND (organism_lo = 2697049 OR organism_hi = 2697049)
          AND node_lo <> node_hi`,
    )

    const cliques = window.prolivis!.cliques(graph, { minSize: 4, maxCliques: 50_000 })
    const largest = cliques.cliques[0] ?? []

    // "Correlates with assay directness" means the preset's final score against the
    // directness term itself, over every interaction that has one.
    const pearson = (xs: readonly number[], ys: readonly number[]) => {
      const n = xs.length
      const mx = xs.reduce((a, b) => a + b, 0) / n
      const my = ys.reduce((a, b) => a + b, 0) / n
      let sxy = 0
      let sxx = 0
      let syy = 0
      for (let i = 0; i < n; i += 1) {
        const dx = xs[i]! - mx
        const dy = ys[i]! - my
        sxy += dx * dy
        sxx += dx * dx
        syy += dy * dy
      }
      return sxy / Math.sqrt(sxx * syy)
    }
    const correlation = async (preset: string) => {
      const rows = (await window.prolivis!.score(query, preset)).filter(
        (p) => p.terms.methodWeight !== null,
      )
      return pearson(
        rows.map((p) => p.score),
        rows.map((p) => p.terms.methodWeight!),
      )
    }

    return {
      proteins: graph.order,
      interactions: graph.size,
      components,
      bridges: structure.bridges.length,
      articulationPoints: structure.articulationPoints.length,
      threshold: THRESHOLD,
      thresholdProteins: thresholded.order,
      thresholdInteractions: thresholded.size,
      cliques: cliques.cliques.length,
      largestClique: largest.length,
      largestCliqueMembers: largest.map((i) => graph.label(i)).sort(),
      singlePublication: Number(support[0]?.single ?? 0),
      pairsWithSupport: Number(support[0]?.total ?? 0),
      corrStrict: await correlation('structural-strict'),
      corrEvidence: await correlation('evidence-only'),
      corrLiterature: await correlation('literature-aware'),
    }
  }, datasetId)
}

/** LaTeX macros, so the manuscript states a measurement rather than a memory. */
function numberMacros(e: Awaited<ReturnType<typeof measureEvidence>>): string {
  const n = (value: number) => value.toLocaleString('en-US').replace(/,/g, '{,}')
  const lines = [
    `\\newcommand{\\CovProteins}{${n(e.proteins)}}`,
    `\\newcommand{\\CovInteractions}{${n(e.interactions)}}`,
    `\\newcommand{\\CovComponents}{${n(e.components)}}`,
    `\\newcommand{\\CovBridges}{${n(e.bridges)}}`,
    `\\newcommand{\\CovArticulation}{${n(e.articulationPoints)}}`,
    `\\newcommand{\\CovThreshold}{${e.threshold}}`,
    `\\newcommand{\\CovThresholdProteins}{${n(e.thresholdProteins)}}`,
    `\\newcommand{\\CovThresholdInteractions}{${n(e.thresholdInteractions)}}`,
    `\\newcommand{\\CovSinglePublication}{${n(e.singlePublication)}}`,
    `\\newcommand{\\CovPairsWithSupport}{${n(e.pairsWithSupport)}}`,
    `\\newcommand{\\CovSinglePercent}{${(
      (100 * e.singlePublication) / Math.max(1, e.pairsWithSupport)
    ).toFixed(0)}}`,
    `\\newcommand{\\CovBridgePercent}{${(
      (100 * e.bridges) / Math.max(1, e.interactions)
    ).toFixed(0)}}`,
    `\\newcommand{\\CovCliques}{${n(e.cliques)}}`,
    `\\newcommand{\\CovLargestClique}{${e.largestClique}}`,
    `\\newcommand{\\CovLargestCliqueMembers}{${e.largestCliqueMembers.join(', ')}}`,
    `\\newcommand{\\CorrStrict}{${e.corrStrict.toFixed(3)}}`,
    `\\newcommand{\\CorrEvidence}{${e.corrEvidence.toFixed(3)}}`,
    `\\newcommand{\\CorrLiterature}{${e.corrLiterature.toFixed(3)}}`,
  ]
  return `% Generated by tests/figures/figures.spec.ts. Do not edit.\n${lines.join('\n')}\n`
}
