/**
 * Programmatic API, exposed on `window.prolivis`.
 *
 * This is a first-class part of the tool, not a test hook. It serves three purposes:
 * a scientist can drive the loaded database from the browser console and pull results
 * out as plain objects; the end-to-end tests exercise the real engine through it; and
 * the paper's figure-generation script (which drives the built app under Playwright)
 * uses it to load data reproducibly.
 */

import { APP_NAME, APP_VERSION } from './app-info'
import { type DuckDBEngine, getEngine, resetEngine } from './data/duckdb'
import {
  ingestFile,
  inspectFile,
  removeDataset,
  type IngestOptions,
  type IngestResult,
} from './data/ingest'
import {
  listDatasets,
  listExperimentalSystems,
  listOrganisms,
  type DatasetSummary,
  type ExperimentalSystemSummary,
  type OrganismSummary,
} from './model/datasets'
import type { ZipEntry } from './data/zip'
import { isKnownExperimentalSystem } from './data/vocabulary'
import {
  enrichLiterature,
  enrichmentCoverage,
  type EnrichmentCoverage,
  type EnrichOptions,
  type EnrichResult,
} from './enrich/enrich'
import { loadContactEmail, saveContactEmail } from './enrich/openalex'
import {
  DEFAULT_PRESET,
  getPreset,
  PRESETS,
  TERM_DESCRIPTIONS,
  type TermDescription,
  type TrustConfig,
} from './trust/model'
import {
  gatherEvidence,
  scoreWithIdentity,
  type EvidenceQuery,
  type GatheredEvidence,
  type ScoredPair,
} from './trust/score'
import { buildCenterGraph, type CenterGraphQuery } from './views/center-graph'
import { PpiGraph } from './algo/graph'
import {
  applySetOperation,
  compareDatasets,
  mergeDatasets,
  type ComparedEdge,
  type ComparisonResult,
  type ComparisonSide,
  type CompareQuery,
  type MergeResult,
  type SetOperation,
} from './compare/compare'
import {
  highLevelToRows,
  pairsToRows,
  toDelimited,
  toGml,
  toGraphml,
  toSif,
  type TabularFormat,
} from './export/formats'
import {
  buildManifest,
  checkReproducibility,
  parseManifest,
  serializeManifest,
  type BuildManifestInput,
  type SessionManifest,
} from './export/manifest'
import {
  biconnectedComponents,
  connectedComponents,
  kCores,
  maximalCliques,
  type BiconnectedResult,
  type CliqueOptions,
  type CliqueResult,
  type Components,
  type CoreResult,
} from './algo/structure'
import {
  removeEdges,
  type RemovalOptions,
  type RemovalResult,
} from './algo/removal'
import {
  contract,
  type ContractOptions,
  type HighLevelGraph,
} from './algo/contract'
import {
  centerLayout,
  type CenterLayoutOptions,
  type CenterLayoutResult,
} from './views/center-layout'
import { centerScene, type CenterSceneOptions } from './views/render/center-scene'
import {
  buildMatrix,
  buildUpSet,
  type MatrixOptions,
  type MatrixView,
  type PairSystems,
  type UpSetView,
} from './views/matrix'
import {
  buildBipartite,
  type BipartiteInput,
  type BipartiteOptions,
  type BipartiteView,
} from './views/bipartite'
import {
  buildMethodChord,
  buildTimeline,
  type ChordView,
  type TimelineOptions,
  type TimelineRecord,
  type TimelineView,
} from './views/timeline'
import { sceneToSvg, type Scene } from './views/render/scene'
import {
  ablate,
  calibrate,
  parseReferenceSet,
  type AblationRow,
  type CalibrationResult,
  type ReferenceSet,
} from './trust/calibrate'
import {
  BioGridRestClient,
  clearAccessKey,
  ingestFromRest,
  isWellFormedAccessKey,
  loadAccessKey,
  saveAccessKey,
  type InteractionQuery,
  type RestIngestOptions,
  type RestIngestResult,
} from './data/biogrid-rest'

export interface ProLiVisApi {
  readonly version: string
  /** The DuckDB engine, created on first use. */
  engine(): Promise<DuckDBEngine>
  /** List the members of a dropped zip without inflating them. */
  inspect(file: File): Promise<ZipEntry[] | null>
  /** Load a BioGRID tab3 file (zipped or plain) as a new dataset. */
  load(file: File, options?: IngestOptions): Promise<IngestResult>
  /** Drop a dataset and everything derived from it. */
  unload(datasetId: string): Promise<void>
  datasets(): Promise<DatasetSummary[]>
  organisms(datasetId: string): Promise<OrganismSummary[]>
  systems(datasetId: string, organismId?: number): Promise<ExperimentalSystemSummary[]>
  /** Run arbitrary SQL against the loaded data and get plain objects back. */
  sql<T = Record<string, unknown>>(query: string): Promise<T[]>
  /**
   * Delete every loaded dataset. The database is persisted in browser storage, so
   * this is the only way to reclaim that space.
   */
  wipe(): Promise<void>
  /** Close the engine and drop the singleton. Data in browser storage survives. */
  reset(): Promise<void>

  // --- online mode ---------------------------------------------------------
  /**
   * Store a BioGRID access key in this browser and confirm it works by asking the
   * service for its release. Returns that release.
   */
  connect(accessKey: string): Promise<string>
  /** Whether an access key has been stored. */
  isConnected(): boolean
  /** Forget the stored access key. */
  disconnect(): void
  /** How many interactions a query would return, without fetching them. */
  countRemote(query: InteractionQuery): Promise<number>
  /** Run a BioGRID query and load the results as a dataset. */
  fetchRemote(
    query: InteractionQuery,
    options?: RestIngestOptions,
  ): Promise<RestIngestResult>
  /** Organisms the service knows about, as taxid to name. */
  remoteOrganisms(): Promise<Map<number, string>>
  /** Experimental system names accepted in a query's `evidenceList`. */
  remoteEvidenceTypes(): Promise<string[]>
  /**
   * Of the given experimental-system names, those absent from our bundled
   * classification. Such assays still load, but are scored with a default prior
   * rather than a considered one, so surfacing them is how we learn that BioGRID has
   * introduced a new method.
   */
  unclassifiedSystems(names: readonly string[]): string[]

  // --- literature enrichment ------------------------------------------------
  /**
   * Fetch citation counts, venues and author institutions for the publications
   * BioGRID cites, from OpenAlex with a PubMed fallback. Results are cached across
   * datasets and survive reloads; nothing here is required for the tool to work.
   */
  enrich(options?: EnrichOptions): Promise<EnrichResult>
  /** How much of the literature is resolved, which bounds what the trust model claims. */
  coverage(datasetId?: string): Promise<EnrichmentCoverage>
  /** Optional contact address; puts OpenAlex requests in their faster polite pool. */
  contactEmail(): string | null
  setContactEmail(email: string | null): void

  // --- citation trust -------------------------------------------------------
  /** The shipped scoring presets, keyed by name. */
  trustPresets(): Readonly<Record<string, TrustConfig>>
  /** What each term measures and why it is in the model. */
  trustTerms(): readonly TermDescription[]
  /**
   * Score a dataset's interactions. Pass a preset name or a full configuration;
   * omitting it uses the documented default.
   */
  score(query: EvidenceQuery, config?: string | TrustConfig): Promise<ScoredPair[]>
  /**
   * Gather evidence once so weights can be changed without re-querying. Feed the
   * result to `rescore` to re-weight interactively.
   */
  gather(query: EvidenceQuery, config?: string | TrustConfig): Promise<GatheredEvidence>
  /** Re-score already-gathered evidence under a different configuration. */
  rescore(gathered: GatheredEvidence, config?: string | TrustConfig): ScoredPair[]
  /** Measure a configuration against a reference set of known interactions. */
  calibrate(
    scored: readonly ScoredPair[],
    reference: ReferenceSet,
  ): CalibrationResult
  /** Leave-one-term-out ablation, showing which terms actually earn their weight. */
  ablate(
    gathered: GatheredEvidence,
    reference: ReferenceSet,
    config?: string | TrustConfig,
  ): AblationRow[]
  /** Parse a user-supplied reference set of gene-symbol pairs. */
  referenceSet(name: string, text: string): ReferenceSet

  // --- center layout --------------------------------------------------------
  /**
   * Compute the three-level center layout for a dataset: organism at the centre,
   * experimental methods around it, publications on the outer band. Deterministic —
   * the same query always gives the same coordinates.
   */
  centerLayout(
    query: CenterGraphQuery,
    options?: CenterLayoutOptions,
  ): Promise<CenterLayoutResult>
  /** Turn a layout into a drawable, surface-independent scene. */
  centerScene(layout: CenterLayoutResult, options?: CenterSceneOptions): Scene
  /** Serialize a scene to standalone, editable SVG for a publication figure. */
  toSvg(scene: Scene, title?: string): string

  // --- further views --------------------------------------------------------
  /**
   * Reorderable adjacency matrix. Shows far more interactions legibly than a
   * node-link diagram, at the cost of making paths hard to trace — which is why both
   * exist. The default ordering puts connected modules on the diagonal as blocks.
   */
  matrix(pairs: readonly ScoredPair[], options?: MatrixOptions): MatrixView
  /**
   * Which combinations of experimental methods actually co-occur. A Venn diagram
   * cannot show more than four sets; this shows all of them.
   */
  upset(pairs: readonly PairSystems[], options?: { maxIntersections?: number; minCount?: number }): UpSetView
  /** Publications against proteins, in lanes by experimental method. */
  bipartite(input: BipartiteInput, options?: BipartiteOptions): BipartiteView
  /**
   * When each interaction entered the literature, and which have been reported once,
   * long ago, and never revisited.
   */
  timeline(records: readonly TimelineRecord[], options?: TimelineOptions): TimelineView
  /** How often two experimental methods support the same interaction. */
  methodChord(
    pairs: readonly { readonly systems: readonly string[] }[],
    options?: { maxGroups?: number },
  ): ChordView

  // --- graph structure ------------------------------------------------------
  /**
   * Build the interaction graph for a query, optionally keeping only edges above a
   * trust threshold. This is the object every structural algorithm operates on.
   */
  graph(
    query: EvidenceQuery,
    options?: { minScore?: number; config?: string | TrustConfig },
  ): Promise<PpiGraph>
  /** Disjoint pieces of the network, largest first. */
  components(graph: PpiGraph): Components
  /**
   * Biconnected components, articulation points and bridges: the proteins and single
   * interactions whose removal would break the network apart.
   */
  modules(graph: PpiGraph): BiconnectedResult
  /** k-core decomposition — the standard first cut at the dense part. */
  cores(graph: PpiGraph): CoreResult
  /** Maximal cliques: the graph-theoretic shadow of protein complexes. */
  cliques(graph: PpiGraph, options?: CliqueOptions): CliqueResult
  /**
   * Remove edges one at a time and record what happens. `trust-ascending` peels the
   * least-supported evidence first, which asks what survives if you only believe the
   * data; `betweenness` is the classical Girvan-Newman order.
   */
  removeEdges(
    graph: PpiGraph,
    strategy: RemovalResult['strategy'],
    options?: RemovalOptions,
  ): RemovalResult
  /** Contract the network to its modules, carrying trust mass on the links between. */
  contract(graph: PpiGraph, options?: ContractOptions): HighLevelGraph

  // --- comparison and merging -----------------------------------------------
  /**
   * Compare two datasets edge by edge — across releases, organisms or queries —
   * keeping which side asserted what.
   */
  compare(query: CompareQuery): Promise<ComparisonResult>
  /** Apply a set operation to a comparison. */
  setOperation(result: ComparisonResult, operation: SetOperation): ComparedEdge[]
  /** Merge datasets into a new one, collapsing records present in more than one. */
  merge(
    sources: readonly ComparisonSide[],
    options?: { label?: string },
  ): Promise<MergeResult>

  // --- export ---------------------------------------------------------------
  /** Scored interactions as CSV or TSV, with every trust term as its own column. */
  exportTable(pairs: readonly ScoredPair[], format?: TabularFormat): string
  /** Cytoscape SIF. */
  exportSif(pairs: readonly ScoredPair[]): string
  /** GraphML, with trust and each term as typed edge attributes. */
  exportGraphml(pairs: readonly ScoredPair[]): string
  /** GML, for OGDF, Gephi and yEd. */
  exportGml(pairs: readonly ScoredPair[]): string
  /** A contracted graph as module and link tables. */
  exportHighLevel(
    graph: HighLevelGraph,
    format?: TabularFormat,
  ): { nodes: string; edges: string }
  /** Arbitrary rows as CSV or TSV, for SQL console results. */
  exportRows(rows: readonly Record<string, unknown>[], format?: TabularFormat): string

  // --- session manifest -----------------------------------------------------
  /** Record everything needed to reproduce the current figure. */
  manifest(input: BuildManifestInput): SessionManifest
  serializeManifest(manifest: SessionManifest): string
  /** Parse a manifest, with warnings for anything this build does not understand. */
  parseManifest(text: string): { manifest: SessionManifest; warnings: string[] }
  /** Whether a manifest can be reproduced against what is currently loaded. */
  checkManifest(
    manifest: SessionManifest,
    available: readonly DatasetSummary[],
  ): { match: DatasetSummary | null; problems: string[] }
}

/** Accept either a preset name or a full configuration. */
function resolveConfig(config?: string | TrustConfig): TrustConfig {
  if (config === undefined) return getPreset(DEFAULT_PRESET)
  return typeof config === 'string' ? getPreset(config) : config
}

/** Build a REST client from the stored key, or fail with a clear message. */
function restClient(): BioGridRestClient {
  const key = loadAccessKey()
  if (key === null || !isWellFormedAccessKey(key)) {
    throw new Error(
      'No BioGRID access key stored. Register for a free key at ' +
        'https://webservice.thebiogrid.org and call prolivis.connect(key).',
    )
  }
  return new BioGridRestClient({ accessKey: key })
}

export const api: ProLiVisApi = {
  version: APP_VERSION,

  engine: () => getEngine(),

  inspect: (file) => inspectFile(file),

  async load(file, options) {
    return ingestFile(await getEngine(), file, options ?? {})
  },

  async unload(datasetId) {
    return removeDataset(await getEngine(), datasetId)
  },

  async datasets() {
    return listDatasets(await getEngine())
  },

  async organisms(datasetId) {
    return listOrganisms(await getEngine(), datasetId)
  },

  async systems(datasetId, organismId) {
    return listExperimentalSystems(await getEngine(), datasetId, organismId)
  },

  async sql<T>(query: string) {
    const engine = await getEngine()
    return engine.rows<T>(query)
  },

  async wipe() {
    const engine = await getEngine()
    await engine.wipe()
  },

  reset: () => resetEngine(),

  async connect(accessKey) {
    const key = accessKey.trim()
    if (!isWellFormedAccessKey(key)) {
      throw new Error(
        'A BioGRID access key is a 32-character alphanumeric string. ' +
          'Register for a free one at https://webservice.thebiogrid.org.',
      )
    }
    // Validate before storing, so a bad key never sits in storage looking valid.
    const release = await new BioGridRestClient({ accessKey: key }).version()
    saveAccessKey(key)
    return release
  },

  isConnected() {
    const key = loadAccessKey()
    return key !== null && isWellFormedAccessKey(key)
  },

  disconnect: () => clearAccessKey(),

  countRemote: (query) => restClient().count(query),

  async fetchRemote(query, options) {
    return ingestFromRest(await getEngine(), restClient(), query, options ?? {})
  },

  remoteOrganisms: () => restClient().organisms(),

  remoteEvidenceTypes: () => restClient().evidenceTypes(),

  unclassifiedSystems: (names) => names.filter((n) => !isKnownExperimentalSystem(n)),

  async enrich(options) {
    return enrichLiterature(await getEngine(), options ?? {})
  },

  async coverage(datasetId) {
    return enrichmentCoverage(await getEngine(), datasetId)
  },

  contactEmail: () => loadContactEmail(),

  setContactEmail: (email) => saveContactEmail(email),

  trustPresets: () => PRESETS,

  trustTerms: () => TERM_DESCRIPTIONS,

  async score(query, config) {
    const resolved = resolveConfig(config)
    const gathered = await gatherEvidence(await getEngine(), query, resolved)
    return scoreWithIdentity(gathered, resolved)
  },

  async gather(query, config) {
    return gatherEvidence(await getEngine(), query, resolveConfig(config))
  },

  rescore: (gathered, config) => scoreWithIdentity(gathered, resolveConfig(config)),

  calibrate: (scored, reference) => calibrate(scored, reference),

  ablate: (gathered, reference, config) =>
    ablate(gathered, resolveConfig(config), reference),

  referenceSet: (name, text) => parseReferenceSet(name, text),

  async centerLayout(query, options) {
    const input = await buildCenterGraph(await getEngine(), query)
    return centerLayout(input, options ?? {})
  },

  centerScene: (layout, options) => centerScene(layout, options ?? {}),

  toSvg: (scene, title) => sceneToSvg(scene, title),

  matrix: (pairs, options) => buildMatrix(pairs, options ?? {}),

  upset: (pairs, options) => buildUpSet(pairs, options ?? {}),

  bipartite: (input, options) => buildBipartite(input, options ?? {}),

  timeline: (records, options) => buildTimeline(records, options ?? {}),

  methodChord: (pairs, options) => buildMethodChord(pairs, options ?? {}),

  async graph(query, options) {
    const resolved = resolveConfig(options?.config)
    const gathered = await gatherEvidence(await getEngine(), query, resolved)
    const scored = scoreWithIdentity(gathered, resolved)
    return PpiGraph.fromPairs(scored, {
      ...(options?.minScore === undefined ? {} : { minScore: options.minScore }),
    })
  },

  components: (graph) => connectedComponents(graph),

  modules: (graph) => biconnectedComponents(graph),

  cores: (graph) => kCores(graph),

  cliques: (graph, options) => maximalCliques(graph, options ?? {}),

  removeEdges: (graph, strategy, options) => removeEdges(graph, strategy, options ?? {}),

  contract: (graph, options) => contract(graph, options ?? {}),

  async compare(query) {
    return compareDatasets(await getEngine(), query)
  },

  setOperation: (result, operation) => applySetOperation(result, operation),

  async merge(sources, options) {
    return mergeDatasets(await getEngine(), sources, options ?? {})
  },

  exportTable: (pairs, format) => toDelimited(pairsToRows(pairs), format ?? 'csv'),

  exportSif: (pairs) => toSif(pairs),

  exportGraphml: (pairs) => toGraphml(pairs),

  exportGml: (pairs) => toGml(pairs),

  exportHighLevel: (graph, format) => {
    const rows = highLevelToRows(graph)
    return {
      nodes: toDelimited(rows.nodes, format ?? 'csv'),
      edges: toDelimited(rows.edges, format ?? 'csv'),
    }
  },

  exportRows: (rows, format) => toDelimited(rows, format ?? 'csv'),

  manifest: (input) => buildManifest(input),

  serializeManifest: (manifest) => serializeManifest(manifest),

  parseManifest: (text) => parseManifest(text),

  checkManifest: (manifest, available) => checkReproducibility(manifest, available),
}

declare global {
  interface Window {
    prolivis?: ProLiVisApi
  }
}

/** Attach the API to `window`. Called once at startup. */
export function installApi(): void {
  window.prolivis = api
  // Discoverability: a scientist opening devtools should find the handle.
  console.warn(
    `${APP_NAME} ${APP_VERSION} — scripting API available as window.prolivis ` +
      `(try: await prolivis.datasets())`,
  )
}
