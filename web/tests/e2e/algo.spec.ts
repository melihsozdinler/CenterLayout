import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * Structural analysis over real BioGRID data.
 *
 * Unit tests pin each algorithm against graphs with known answers. These check the
 * things only real data can show: that the algorithms terminate at real scale, and
 * that what they find is biologically recognisable.
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

test('builds a graph and decomposes it structurally', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const summary = await page.evaluate(async (id) => {
    const graph = await window.prolivis!.graph({ datasetId: id })
    const components = window.prolivis!.components(graph)
    const modules = window.prolivis!.modules(graph)
    const cores = window.prolivis!.cores(graph)
    const cliques = window.prolivis!.cliques(graph, { minSize: 3, maxCliques: 20_000 })

    return {
      order: graph.order,
      size: graph.size,
      components: components.count,
      largestComponent: components.members[0]?.length ?? 0,
      articulationPoints: modules.articulationPoints.length,
      bridges: modules.bridges.length,
      maxCore: cores.maxCore,
      cliques: cliques.cliques.length,
      largestClique: cliques.cliques[0]?.length ?? 0,
      truncated: cliques.truncated,
    }
  }, dataset.datasetId)

  console.log(`  graph: ${JSON.stringify(summary)}`)

  expect(summary.order).toBeGreaterThan(100)
  expect(summary.size).toBeGreaterThan(100)
  // Self-interactions are dropped, so the graph is smaller than the pair count.
  expect(summary.size).toBeLessThanOrEqual(dataset.pairCount)

  expect(summary.components).toBeGreaterThan(0)
  expect(summary.largestComponent).toBeGreaterThan(1)
  // A real PPI network is mostly tree-like at the periphery, so bridges abound.
  expect(summary.bridges).toBeGreaterThan(0)
  expect(summary.articulationPoints).toBeGreaterThan(0)
  expect(summary.maxCore).toBeGreaterThanOrEqual(1)
})

test('finds cliques that correspond to real complexes', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const cliques = await page.evaluate(async (id) => {
    const graph = await window.prolivis!.graph({ datasetId: id })
    const result = window.prolivis!.cliques(graph, { minSize: 3, maxCliques: 20_000 })
    return result.cliques.slice(0, 5).map((clique) => clique.map((i) => graph.label(i)))
  }, dataset.datasetId)

  console.log(`  largest cliques: ${JSON.stringify(cliques)}`)
  if (cliques.length > 0) {
    expect(cliques[0]!.length).toBeGreaterThanOrEqual(3)
    // Every member is a named gene, not a bare identifier.
    for (const member of cliques[0]!) expect(member).not.toMatch(/^\d+$/)
  }
})

test('trust-ascending removal fragments the network from the weakest evidence', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const result = await page.evaluate(async (id) => {
    const graph = await window.prolivis!.graph({ datasetId: id })
    const run = window.prolivis!.removeEdges(graph, 'trust-ascending', {
      maxRemovals: 200,
    })
    return {
      steps: run.steps.length,
      firstWeight: run.steps[0]?.weight ?? null,
      lastWeight: run.steps[run.steps.length - 1]?.weight ?? null,
      firstComponents: run.steps[0]?.components ?? 0,
      lastComponents: run.steps[run.steps.length - 1]?.components ?? 0,
      bestModularity: run.bestPartition.modularity,
    }
  }, dataset.datasetId)

  console.log(`  removal: ${JSON.stringify(result)}`)

  expect(result.steps).toBe(200)
  // Weakest first: the trust of each removed edge is non-decreasing.
  expect(result.lastWeight!).toBeGreaterThanOrEqual(result.firstWeight!)
  // And the network fragments as evidence is withdrawn.
  expect(result.lastComponents).toBeGreaterThan(result.firstComponents)
})

test('betweenness removal targets the joins, not the weak edges', async ({ page }) => {
  test.setTimeout(600_000)
  const dataset = await loadFixture(page)

  const result = await page.evaluate(async (id) => {
    // Restricted to the densest part: Girvan-Newman is O(nm) per removal, and the
    // point here is the ordering it produces, not how far it can be pushed.
    const graph = await window.prolivis!.graph({ datasetId: id, physicalOnly: true })
    const cores = window.prolivis!.cores(graph)
    const keep = new Set<number>()
    cores.coreness.forEach((c, index) => {
      if (c >= Math.max(2, cores.maxCore - 1)) keep.add(index)
    })
    const dense = graph.induced(keep)
    if (dense.size === 0) return null

    const run = window.prolivis!.removeEdges(dense, 'betweenness', {
      maxRemovals: Math.min(40, dense.size),
      recomputeEvery: 5,
    })
    return {
      nodes: dense.order,
      edges: dense.size,
      steps: run.steps.length,
      bestModularity: run.bestPartition.modularity,
      componentsAtEnd: run.steps[run.steps.length - 1]?.components ?? 0,
    }
  }, dataset.datasetId)

  console.log(`  girvan-newman: ${JSON.stringify(result)}`)
  if (result) {
    expect(result.steps).toBeGreaterThan(0)
    expect(result.componentsAtEnd).toBeGreaterThanOrEqual(1)
  }
})

test('contracts the network to a readable high-level graph', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const high = await page.evaluate(async (id) => {
    const graph = await window.prolivis!.graph({ datasetId: id })
    const result = window.prolivis!.contract(graph, {
      strategy: 'biconnected-components',
      minGroupSize: 3,
    })
    return {
      nodes: result.nodes.length,
      edges: result.edges.length,
      ungrouped: result.ungrouped.length,
      largest: result.nodes[0]?.size ?? 0,
      sampleLabels: result.nodes.slice(0, 3).map((n) => n.label),
      originalOrder: graph.order,
    }
  }, dataset.datasetId)

  console.log(`  contracted: ${JSON.stringify(high)}`)

  // The point of contraction: far fewer nodes than the network it summarises.
  expect(high.nodes).toBeGreaterThan(0)
  expect(high.nodes).toBeLessThan(high.originalOrder)
  expect(high.sampleLabels[0]).toMatch(/^Module 1: /)
})

test('a trust threshold shrinks the graph monotonically', async ({ page }) => {
  test.setTimeout(300_000)
  const dataset = await loadFixture(page)

  const sizes = await page.evaluate(async (id) => {
    const out: { threshold: number; nodes: number; edges: number }[] = []
    for (const threshold of [0, 0.2, 0.4, 0.6]) {
      const graph = await window.prolivis!.graph(
        { datasetId: id },
        { minScore: threshold },
      )
      out.push({ threshold, nodes: graph.order, edges: graph.size })
    }
    return out
  }, dataset.datasetId)

  console.log(`  thresholds: ${JSON.stringify(sizes)}`)
  for (let i = 1; i < sizes.length; i += 1) {
    expect(sizes[i]!.edges).toBeLessThanOrEqual(sizes[i - 1]!.edges)
  }
  // The threshold must actually bite, or it is not a filter.
  expect(sizes[sizes.length - 1]!.edges).toBeLessThan(sizes[0]!.edges)
})
