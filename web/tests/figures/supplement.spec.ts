import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Figures and measured output for the supplement, which walks through every capability.
 *
 * The coronavirus release rather than the full one: the supplement shows what each
 * feature does, and a reader who wants to follow along can download 4.5 MB. Anything
 * that only means something at scale is measured in the paper instead.
 *
 *   PROLIVIS_FIGURE_SOURCE=~/Downloads/BIOGRID-CORONAVIRUS-5.0.260.tab3.zip \
 *     npx playwright test --config playwright.figures.config.ts supplement
 */

const here = dirname(fileURLToPath(import.meta.url))
const OUTPUT = resolve(here, '../../../paper/supplement')
const SOURCE = process.env['PROLIVIS_FIGURE_SOURCE']

/** SARS-CoV-2, the coronavirus release's dominant organism. */
const SARS_COV_2 = 2697049

test.skip(!SOURCE, 'set PROLIVIS_FIGURE_SOURCE to a BioGRID release')

test('shoot the supplement', async ({ page }) => {
  test.setTimeout(45 * 60_000)
  mkdirSync(OUTPUT, { recursive: true })

  await page.setViewportSize({ width: 1500, height: 950 })
  await page.goto('/')
  await page.evaluate(() => window.prolivis!.wipe())
  await page.reload()

  // 1. The empty application, before any data.
  await shoot(page, 'empty')

  await page.setInputFiles('input[type="file"]', SOURCE!)
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.prolivis!.datasets()))[0]?.recordCount ?? 0,
      { timeout: 20 * 60_000, intervals: [3_000] },
    )
    .toBeGreaterThan(0)
  await settle(page)

  const dataset = await page.evaluate(async () => (await window.prolivis!.datasets())[0]!)
  console.log(
    `  source: ${SOURCE!.replace(/^.*\//, '')} — ${dataset.recordCount.toLocaleString()} records`,
  )

  const set = (patch: Record<string, unknown>) =>
    page.evaluate((p) => window.prolivis!.ui!.getState().updateSettings(p), patch)
  const setNetwork = (patch: Record<string, unknown>) =>
    page.evaluate((p) => window.prolivis!.ui!.getState().updateNetwork(p), patch)

  await page.evaluate(
    (id) => window.prolivis!.ui!.getState().selectOrganism(id),
    SARS_COV_2,
  )
  await settle(page)

  // 2-4. The literature view: as reported, folded, filtered.
  await shoot(page, 'literature')
  await set({ aggregateBelow: 5 })
  await settle(page)
  await shoot(page, 'literature-folded')
  await set({ aggregateBelow: 0, minInteractions: 20 })
  await settle(page)
  await shoot(page, 'literature-filtered')
  await shootPanel(page, '.panel.filter', 'filter-panel')
  await set({ minInteractions: null })
  await settle(page)

  // 5. A publication's own network, reached by clicking its node.
  const publication = await page.evaluate(async () => {
    const state = window.prolivis!.ui!.getState()
    const hits = await window.prolivis!.topPublications(state.activeDatasetId!, 3, 2697049)
    return hits[1] ?? hits[0]!
  })
  await page.evaluate(
    (hit) =>
      window.prolivis!.ui!.getState().setScope({
        kind: 'publication',
        keys: [hit.publicationKey],
        label: hit.label,
      }),
    publication,
  )
  await settle(page)
  await shoot(page, 'publication-network')

  await page.evaluate(() => window.prolivis!.ui!.getState().setScope(null))
  await settle(page)

  // 6-9. The network view and its arrangements.
  //
  // Deliberately not the whole organism: at this release SARS-CoV-2 is 8,510 proteins,
  // and a figure of that says only "it is large". What each arrangement *means* is
  // legible at a hundred proteins, so the density controls are set to get there — which
  // is what a reader would do, and demonstrates those controls at the same time.
  await setNetwork({
    minTrust: 0.4,
    minDegree: 2,
    maxEdges: 400,
    grouping: 'proteins',
    mode: 'force',
  })
  await page.evaluate(() => window.prolivis!.ui!.getState().setView('network'))
  await settle(page)
  const size = await page.evaluate(() => window.prolivis!.ui!.getState().networkStats)
  console.log(
    `  network figures: ${size?.nodes ?? 0} proteins, ${size?.edges ?? 0} interactions`,
  )
  await shoot(page, 'network-force')
  for (const mode of ['layered', 'grouped', 'circular'] as const) {
    // Grouped is coloured by community: the arrangement is about communities, and a
    // single node colour leaves the reader to infer from position what colour states.
    await setNetwork({ mode, colourBy: mode === 'grouped' ? 'module' : 'trust' })
    await settle(page)
    await shoot(page, `network-${mode}`)
  }
  await setNetwork({ colourBy: 'trust' })

  // A large network under Force: Barnes–Hut repulsion draws the whole organism at the
  // default threshold, where exact repulsion used to give up and draw Grouped.
  await setNetwork({ mode: 'force', minTrust: 0.15, minDegree: 1, maxEdges: 4000 })
  await settle(page)
  await shoot(page, 'network-force-large')
  await setNetwork({ mode: 'grouped', colourBy: 'module' })
  await settle(page)
  await shoot(page, 'network-grouped-large')
  await setNetwork({ colourBy: 'trust' })

  // A sparse network: one method's interactions fall into many components, which Force
  // now lays out one at a time and packs around the largest.
  await page.evaluate(() =>
    window.prolivis!.ui!.getState().setScope({
      kind: 'system',
      keys: ['Reconstituted Complex'],
      label: 'Reconstituted Complex',
    }),
  )
  await settle(page)
  await setNetwork({ mode: 'force', grouping: 'proteins' })
  await settle(page)
  await shoot(page, 'network-sparse')
  await page.evaluate(() => window.prolivis!.ui!.getState().setScope(null))
  await settle(page)

  // Back to the fifty-protein network for the protein panel.
  await setNetwork({ minTrust: 0.4, minDegree: 2, maxEdges: 400, mode: 'force' })
  await settle(page)

  // 10. One protein, its partners and the evidence behind each. A protein with a few
  // dozen partners rather than the hub with two thousand: the panel lists evidence per
  // partner, and a list that needs scrolling shows nothing a shorter one does not.
  const hub = await page.evaluate(() => {
    const network = window.prolivis!.ui!.getState().network!
    const ranked = [...network.nodes].sort((a, b) => b.degree - a.degree)
    const modest = ranked.find((n) => n.degree >= 8 && n.degree <= 40)
    return (modest ?? ranked[0]!).id
  })
  await page.evaluate((id) => window.prolivis!.ui!.getState().focusProtein(id), hub)
  await settle(page)
  await shoot(page, 'protein-panel')

  // 11. A link out to another database, framed beside the network.
  const framed = await page.evaluate(() => {
    const state = window.prolivis!.ui!.getState()
    const focus = state.focus
    if (!focus) return null
    for (const resource of state.resources) {
      if (resource.display === 'tab') continue
      const url = window.prolivis!.resourceUrl(resource, {
        symbol: focus.symbol,
        biogridId: focus.biogridId,
        organismId: focus.organismId ?? undefined,
        organismName: focus.organism ?? undefined,
      })
      if (url) {
        state.openExternal(resource, url)
        return resource.name
      }
    }
    return null
  })
  if (framed) {
    await page.waitForTimeout(2500)
    await shoot(page, 'external-panel')
    await page.evaluate(() => window.prolivis!.ui!.getState().closeExternal())
  }
  await page.evaluate(() => window.prolivis!.ui!.getState().focusProtein(null))
  await settle(page)

  // 12-13. The modules view, and one module opened.
  await setNetwork({ minTrust: 0, grouping: 'modules' })
  await settle(page)
  await shoot(page, 'modules')
  const opened = await page.evaluate(() => {
    const high = window.prolivis!.ui!.getState().highLevel
    if (!high) return null
    const biggest = [...high.nodes].sort((a, b) => b.size - a.size)[0]!
    void window.prolivis!.ui!.getState().drillInto(biggest.id)
    return biggest.label
  })
  if (opened) {
    await settle(page)
    await shoot(page, 'modules-drill')
    await page.evaluate(() => window.prolivis!.ui!.getState().drillTo(0))
    await settle(page)
  }

  // 14. The adjacency matrix, at a size where the blocks on the diagonal can be seen.
  await setNetwork({ minTrust: 0.4, minDegree: 2, maxEdges: 400, grouping: 'proteins' })
  await page.evaluate(() => window.prolivis!.ui!.getState().setView('matrix'))
  await settle(page)
  await shoot(page, 'matrix')

  // 15-16. Searching the literature, and gathering a reading list from it.
  await page.evaluate(() => window.prolivis!.ui!.getState().setView('center'))
  await page.evaluate(() => window.prolivis!.ui!.getState().searchLiterature('2020'))
  await settle(page)
  await shootPanel(page, '.app-sidebar', 'literature-search')
  const collected = await page.evaluate(() => {
    const state = window.prolivis!.ui!.getState()
    const hits = state.literatureResults.slice(0, 3)
    for (const hit of hits) state.toggleCollected(hit)
    return hits.length
  })
  await settle(page)
  await shootPanel(page, '.panel.collection', 'collection')

  // 17. That reading list saved as a dataset, and compared with its source.
  if (collected > 0) {
    await page.evaluate(() =>
      window.prolivis!.ui!.getState().saveCollection('Reading list'),
    )
    await settle(page)
    await shootPanel(page, '.app-sidebar', 'derived-dataset')

    await page.evaluate(async () => {
      const state = window.prolivis!.ui!.getState()
      const other = (await window.prolivis!.datasets()).find(
        (d) => d.datasetId !== state.activeDatasetId,
      )
      if (other) await state.compareTo(other.datasetId)
    })
    await settle(page)
    await shootPanel(page, '.app-sidebar', 'compare')
  }

  // Everything the interface cannot draw, computed through the API instead.
  const computed = await page.evaluate(async (organismId) => {
    const state = window.prolivis!.ui!.getState()
    const datasets = await window.prolivis!.datasets()
    const source = datasets.find((d) => d.sourceKind === 'file')!
    const datasetId = source.datasetId
    const query = { datasetId, organismId, physicalOnly: true, excludeSelfInteractions: true }

    const scored = await window.prolivis!.score(query)
    const systems = await window.prolivis!.pairSystems(query)
    const upset = window.prolivis!.upset(systems, { maxIntersections: 8 })
    const timeline = window.prolivis!.timeline(
      await window.prolivis!.timelineRecords(query),
    )
    const chord = window.prolivis!.methodChord(systems)
    const bipartite = window.prolivis!.bipartite(
      await window.prolivis!.bipartiteInput(query, { maxPublications: 12 }),
    )
    const graph = window.prolivis!.graphFrom(scored)

    return {
      datasetId,
      interactions: scored.length,
      upset: upset.intersections.slice(0, 8).map((i) => ({
        systems: i.systems,
        count: i.count,
      })),
      timeline: timeline.methods.slice(0, 6).map((m) => ({
        system: m.system,
        total: m.total,
        peakYear:
          timeline.years[m.byYear.indexOf(Math.max(...m.byYear))] ?? null,
      })),
      years: [timeline.years[0] ?? null, timeline.years[timeline.years.length - 1] ?? null],
      stale: timeline.staleSingletons.length,
      chord: [...chord.chords]
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
        .map((c) => ({ source: c.source, target: c.target, value: c.value })),
      bipartite: {
        nodes: bipartite.nodes.length,
        links: bipartite.links.length,
        lanes: bipartite.lanes.map((lane) => lane.system),
        truncated: bipartite.truncated,
      },
      graph: { nodes: graph.order, edges: graph.size },
      cliques: window.prolivis!.cliques(graph, { minSize: 4, maxCliques: 5000 }).cliques.length,
      presets: Object.keys(window.prolivis!.trustPresets()),
      exports: {
        csv: window.prolivis!.exportTable(scored.slice(0, 3), 'csv').split('\n')[0],
        sif: window.prolivis!.exportSif(scored.slice(0, 2)).split('\n'),
      },
      state: {
        views: ['center', 'network', 'matrix'],
        active: state.view,
      },
    }
  }, SARS_COV_2)

  writeFileSync(
    resolve(OUTPUT, 'computed.json'),
    `${JSON.stringify({ source: SOURCE!.replace(/^.*\//, ''), release: dataset.biogridRelease, ...computed }, null, 2)}\n`,
    'utf8',
  )
  // Tables, generated for the same reason the paper's numbers are: a supplement that
  // shows what the tool produces should show what it actually produced.
  const rows = (list: string[]) => list.join('\n')
  writeFileSync(
    resolve(OUTPUT, 'tables.tex'),
    [
      '% Generated by tests/figures/supplement.spec.ts. Do not edit.',
      '\\newcommand{\\SuppUpset}{%',
      rows(
        computed.upset.map(
          (row) => `  ${row.systems.join(' + ')} & ${row.count.toLocaleString('en-US').replace(/,/g, '{,}')} \\\\`,
        ),
      ),
      '}',
      '\\newcommand{\\SuppTimeline}{%',
      rows(
        computed.timeline.map(
          (row) =>
            `  ${row.system} & ${row.total.toLocaleString('en-US').replace(/,/g, '{,}')} & ${row.peakYear ?? '--'} \\\\`,
        ),
      ),
      '}',
      '\\newcommand{\\SuppChord}{%',
      rows(
        computed.chord.map(
          (row) =>
            `  ${row.source} & ${row.target} & ${row.value.toLocaleString('en-US').replace(/,/g, '{,}')} \\\\`,
        ),
      ),
      '}',
      `\\newcommand{\\SuppInteractions}{${computed.interactions.toLocaleString('en-US').replace(/,/g, '{,}')}}`,
      `\\newcommand{\\SuppProteins}{${computed.graph.nodes.toLocaleString('en-US').replace(/,/g, '{,}')}}`,
      `\\newcommand{\\SuppYearFirst}{${computed.years[0] ?? '--'}}`,
      `\\newcommand{\\SuppYearLast}{${computed.years[1] ?? '--'}}`,
      `\\newcommand{\\SuppBipartiteNodes}{${computed.bipartite.nodes}}`,
      `\\newcommand{\\SuppBipartiteLinks}{${computed.bipartite.links.toLocaleString('en-US').replace(/,/g, '{,}')}}`,
      `\\newcommand{\\SuppBipartiteLanes}{${computed.bipartite.lanes.length}}`,
      `\\newcommand{\\SuppRelease}{${dataset.biogridRelease ?? 'unknown'}}`,
      `\\newcommand{\\SuppRecords}{${dataset.recordCount.toLocaleString('en-US').replace(/,/g, '{,}')}}`,
      '',
    ].join('\n'),
    'utf8',
  )

  console.log(
    `  computed: ${computed.upset.length} method combinations, ` +
      `${computed.timeline.length} years, ${computed.chord.length} method links, ` +
      `${computed.cliques} cliques`,
  )
})

async function settle(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.prolivis!.ui!.getState().busy === null), {
      timeout: 10 * 60_000,
      intervals: [500],
    })
    .toBe(true)
  await page.waitForTimeout(900)
}

async function shoot(page: Page, slug: string) {
  await page.screenshot({ path: resolve(OUTPUT, `${slug}.png`) })
}

async function shootPanel(page: Page, selector: string, slug: string) {
  const panel = page.locator(selector).first()
  if ((await panel.count()) === 0) return
  await panel.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await panel.screenshot({ path: resolve(OUTPUT, `${slug}.png`) })
}
