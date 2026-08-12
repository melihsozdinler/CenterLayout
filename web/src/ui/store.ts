/**
 * Application state.
 *
 * Deliberately small: the database is the source of truth, and this holds only what
 * the user has chosen — which dataset, which organism, which layout options — so that
 * a session manifest can be built from it directly.
 */

import { create } from 'zustand'
import { api } from '../api'
import type { DatasetSummary, OrganismSummary } from '../model/datasets'
import type { CenterLayoutResult } from '../views/center-layout'
import type { NetworkLayoutResult, NetworkLayoutMode } from '../views/network-layout'
import type { MatrixView, MatrixOrdering } from '../views/matrix'
import type { NetworkColouring } from '../views/render/network-scene'
import type { ComparisonResult } from '../compare/compare'
import type { ProteinDetail } from '../model/protein'
import type { ExternalResource } from '../external/resources'
import type { PublicationHit, PublicationSummary } from '../model/publications'
import type { IngestProgress } from '../data/ingest'
import type { ZipEntry } from '../data/zip'

export type ViewKind = 'center' | 'network' | 'matrix'

/**
 * A restriction of the network to part of the literature.
 *
 * This is the drill-down the literature view exists for: a publication node answers
 * "who reported this", and scoping to it answers "and what did they report". Method
 * scoping is the same move one level up — every interaction a technique has produced.
 */
export interface Scope {
  readonly kind: 'publication' | 'system'
  /** Publication keys, or experimental system names. */
  readonly keys: readonly string[]
  readonly label: string
}

export interface NetworkSettings {
  /** Hide interactions scoring below this. Most reported interactions are weak. */
  readonly minTrust: number
  readonly mode: NetworkLayoutMode
  readonly colourBy: NetworkColouring
  readonly ordering: MatrixOrdering
  readonly physicalOnly: boolean
  /** Drop proteins with fewer than this many partners. */
  readonly minDegree: number
  /** Keep only this many best-supported interactions. */
  readonly maxEdges: number
  /** Hops shown around a focused protein. */
  readonly focusDepth: number
}

export interface LayoutSettings {
  /** Fold methods with fewer publications than this into one node. 0 disables. */
  readonly aggregateBelow: number
  readonly multiMethod: 'circular-mean' | 'duplicate'
  readonly showPublicationLabels: boolean
}

interface AppState {
  datasets: DatasetSummary[]
  activeDatasetId: string | null
  organisms: OrganismSummary[]
  activeOrganismId: number | null

  view: ViewKind
  layout: CenterLayoutResult | null
  layoutSettings: LayoutSettings
  selectedNodeId: string | null

  network: NetworkLayoutResult | null
  matrix: MatrixView | null
  networkSettings: NetworkSettings
  networkStats: { nodes: number; edges: number; hidden: number } | null
  selectedNodeIndex: number | null

  comparison: ComparisonResult | null
  compareWith: string | null

  /** BioGRID gene id the view is centred on, if any. */
  scope: Scope | null
  scopeDetail: PublicationSummary | null
  literatureQuery: string
  literatureResults: PublicationHit[]

  focusId: number | null
  focus: ProteinDetail | null
  /**
   * Proteins focused before this one. Walking partner to partner is the natural way
   * to explore, and without a trail there is no way back to where you started.
   */
  focusHistory: number[]
  searchResults: { biogridId: number; symbol: string; organism: string | null }[]

  resources: ExternalResource[]
  /** Resource currently open in the side panel, if any. */
  openResource: { resource: ExternalResource; url: string } | null

  busy: string | null
  progress: IngestProgress | null
  error: string | null
  /** Non-fatal condition worth telling the user about, e.g. storage unavailable. */
  warning: string | null
  /** Set when a dropped archive holds several members and one must be chosen. */
  pendingEntries: { file: File; entries: ZipEntry[] } | null

  refreshDatasets: () => Promise<void>
  loadFile: (file: File, entryName?: string) => Promise<void>
  chooseEntry: (entryName: string) => Promise<void>
  cancelEntryChoice: () => void
  selectDataset: (datasetId: string | null) => Promise<void>
  selectOrganism: (organismId: number | null) => Promise<void>
  updateSettings: (settings: Partial<LayoutSettings>) => Promise<void>
  selectNode: (nodeId: string | null) => void
  removeDataset: (datasetId: string) => Promise<void>
  dismissError: () => void

  setView: (view: ViewKind) => Promise<void>
  updateNetwork: (settings: Partial<NetworkSettings>) => Promise<void>
  selectNetworkNode: (index: number | null) => void
  compareTo: (datasetId: string | null) => Promise<void>
  mergeWith: (datasetId: string) => Promise<void>
  /**
   * Restrict the network to one publication's or one method's interactions, and show
   * it. Passing null returns to the whole network.
   */
  setScope: (scope: Scope | null) => Promise<void>
  searchLiterature: (query: string) => Promise<void>
  /** Centre the network on one protein and list its interactions. */
  focusProtein: (biogridId: number | null) => Promise<void>
  /** Step back to the previously focused protein, or to the whole network. */
  focusBack: () => Promise<void>
  searchProteins: (query: string) => Promise<void>

  openExternal: (resource: ExternalResource, url: string) => void
  closeExternal: () => void
  updateResources: (resources: readonly ExternalResource[]) => void
  restoreResources: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const useApp = create<AppState>((set, get) => ({
  datasets: [],
  activeDatasetId: null,
  organisms: [],
  activeOrganismId: null,
  view: 'center',
  layout: null,
  layoutSettings: {
    aggregateBelow: 0,
    multiMethod: 'circular-mean',
    showPublicationLabels: true,
  },
  selectedNodeId: null,

  network: null,
  matrix: null,
  networkSettings: {
    // Not zero by default: at zero the view is dominated by single-publication
    // claims, and the user should see the well-supported network first.
    minTrust: 0.15,
    mode: 'force',
    colourBy: 'trust',
    ordering: 'cluster',
    physicalOnly: true,
    minDegree: 1,
    maxEdges: 4000,
    focusDepth: 1,
  },
  networkStats: null,
  selectedNodeIndex: null,

  comparison: null,
  compareWith: null,
  scope: null,
  scopeDetail: null,
  literatureQuery: '',
  literatureResults: [],
  focusId: null,
  focus: null,
  focusHistory: [],
  searchResults: [],
  resources: api.resources(),
  openResource: null,
  busy: null,
  progress: null,
  error: null,
  warning: null,
  pendingEntries: null,

  async refreshDatasets() {
    try {
      const datasets = await api.datasets()
      const engine = await api.engine()
      set({
        datasets,
        // Not an error: the app works, but the user should know their data is not
        // being kept before they spend ten minutes loading a release.
        warning: engine.info.persistenceError,
      })
      if (get().activeDatasetId === null && datasets[0]) {
        await get().selectDataset(datasets[0].datasetId)
      }
    } catch (e) {
      set({ error: message(e) })
    }
  },

  async loadFile(file, entryName) {
    set({ error: null, busy: `Reading ${file.name}`, progress: null })
    try {
      if (entryName === undefined) {
        const entries = await api.inspect(file)
        const usable = entries?.filter((e) => /\.(txt|tsv|tab3)$/i.test(e.name)) ?? []
        // A bundle such as BIOGRID-ORGANISM holds one file per organism; the user
        // must say which, rather than us guessing.
        if (usable.length > 1) {
          set({ pendingEntries: { file, entries: usable }, busy: null })
          return
        }
      }

      const result = await api.load(file, {
        ...(entryName === undefined ? {} : { entryName }),
        onProgress: (progress) => set({ progress }),
      })
      set({ pendingEntries: null })
      await get().refreshDatasets()
      // refreshDatasets selects the first dataset when none is active, so re-selecting
      // the same one here would redo every query behind it — and, before this was
      // noticed, silently cleared state that had just been populated.
      if (get().activeDatasetId !== result.datasetId) {
        await get().selectDataset(result.datasetId)
      }
    } catch (e) {
      set({ error: message(e) })
    } finally {
      set({ busy: null, progress: null })
    }
  },

  async chooseEntry(entryName) {
    const pending = get().pendingEntries
    if (!pending) return
    set({ pendingEntries: null })
    await get().loadFile(pending.file, entryName)
  },

  cancelEntryChoice: () => set({ pendingEntries: null }),

  async selectDataset(datasetId) {
    set({
      activeDatasetId: datasetId,
      selectedNodeId: null,
      layout: null,
      scope: null,
      scopeDetail: null,
      focusId: null,
      focus: null,
      literatureResults: [],
    })
    if (datasetId === null) {
      set({ organisms: [], activeOrganismId: null })
      return
    }
    const organisms = await api.organisms(datasetId)
    set({ organisms })
    // Default to the most abundant organism: the whole-dataset view of a
    // cross-species set is rarely what anyone means.
    await get().selectOrganism(organisms[0]?.organismId ?? null)
    await get().searchLiterature(get().literatureQuery)
  },

  async selectOrganism(organismId) {
    set({ activeOrganismId: organismId, selectedNodeId: null, selectedNodeIndex: null })
    await rebuildLayout(set, get)
    await get().searchLiterature(get().literatureQuery)
  },

  async setView(view) {
    set({ view })
    await rebuildLayout(set, get)
  },

  async updateNetwork(settings) {
    set({
      networkSettings: { ...get().networkSettings, ...settings },
      selectedNodeIndex: null,
    })
    await rebuildLayout(set, get)
  },

  selectNetworkNode: (index) =>
    set({ selectedNodeIndex: get().selectedNodeIndex === index ? null : index }),

  async setScope(scope) {
    const dataset = get().activeDatasetId
    if (dataset === null) return

    // Scoping and focusing are alternative questions, not composable ones: a
    // publication's graph centred on one of its proteins is the protein's ego view
    // with most of the publication missing, which is nobody's question.
    set({ scope, focusId: null, focus: null, focusHistory: [], openResource: null })

    if (scope === null) {
      set({ scopeDetail: null })
      await rebuildLayout(set, get)
      return
    }

    set({ view: 'network', busy: 'Building interaction graph' })
    try {
      const detail =
        scope.kind === 'publication' && scope.keys[0]
          ? await api.publication(dataset, scope.keys[0])
          : null
      set({ scopeDetail: detail, error: null })
    } catch (e) {
      set({ error: message(e) })
    } finally {
      set({ busy: null })
    }
    await rebuildLayout(set, get)
  },

  async searchLiterature(query) {
    set({ literatureQuery: query })
    const dataset = get().activeDatasetId
    if (dataset === null) {
      set({ literatureResults: [] })
      return
    }
    try {
      const organismId = get().activeOrganismId
      const results =
        query.trim() === ''
          ? await api.topPublications(dataset, 15, organismId ?? undefined)
          : await api.findPublications(dataset, query, 25)
      set({ literatureResults: results })
    } catch (e) {
      // Do not swallow this. An empty list looks like "no literature here", which is
      // a claim about the data; a failed query is a claim about the tool, and the two
      // must not be confused.
      console.error('literature search failed', e)
      set({ literatureResults: [], error: message(e) })
    }
  },

  async focusProtein(biogridId) {
    const dataset = get().activeDatasetId
    if (dataset === null) return

    if (biogridId === null) {
      // Back to the whole network, and the trail is spent.
      set({ focusId: null, focus: null, focusHistory: [], openResource: null })
      await rebuildLayout(set, get)
      return
    }

    const current = get().focusId
    set({ busy: 'Loading interactions' })
    try {
      const focus = await api.protein(dataset, biogridId)
      set({
        focus,
        focusId: biogridId,
        view: 'network',
        openResource: null,
        focusHistory:
          current === null || current === biogridId
            ? get().focusHistory
            : [...get().focusHistory, current],
        error: null,
      })
    } catch (e) {
      set({ error: message(e) })
    } finally {
      set({ busy: null })
    }
    await rebuildLayout(set, get)
  },

  async focusBack() {
    const history = [...get().focusHistory]
    const previous = history.pop()
    if (previous === undefined) {
      await get().focusProtein(null)
      return
    }
    const dataset = get().activeDatasetId
    if (dataset === null) return

    set({ busy: 'Loading interactions' })
    try {
      const focus = await api.protein(dataset, previous)
      set({ focus, focusId: previous, focusHistory: history, openResource: null })
    } catch (e) {
      set({ error: message(e) })
    } finally {
      set({ busy: null })
    }
    await rebuildLayout(set, get)
  },

  openExternal(resource, url) {
    if (resource.display === 'tab') {
      // noopener so the opened page cannot reach back into this one.
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    set({ openResource: { resource, url } })
  },

  closeExternal: () => set({ openResource: null }),

  updateResources(resources) {
    try {
      api.setResources(resources)
      set({ resources: [...resources], error: null })
    } catch (e) {
      set({ error: message(e) })
    }
  },

  restoreResources: () => set({ resources: api.resetResources() }),

  async searchProteins(query) {
    const dataset = get().activeDatasetId
    if (dataset === null || query.trim() === '') {
      set({ searchResults: [] })
      return
    }
    try {
      set({ searchResults: await api.findProteins(dataset, query, 12) })
    } catch {
      set({ searchResults: [] })
    }
  },

  async compareTo(datasetId) {
    const active = get().activeDatasetId
    set({ compareWith: datasetId })
    if (datasetId === null || active === null) {
      set({ comparison: null })
      return
    }
    set({ busy: 'Comparing datasets' })
    try {
      const comparison = await api.compare({
        left: { datasetId: active, label: labelOf(get(), active) },
        right: { datasetId, label: labelOf(get(), datasetId) },
      })
      set({ comparison, error: null })
    } catch (e) {
      set({ error: message(e), comparison: null })
    } finally {
      set({ busy: null })
    }
  },

  async mergeWith(datasetId) {
    const active = get().activeDatasetId
    if (active === null) return
    set({ busy: 'Merging datasets' })
    try {
      const merged = await api.merge([{ datasetId: active }, { datasetId }], {
        label: `${labelOf(get(), active)} + ${labelOf(get(), datasetId)}`,
      })
      set({ comparison: null, compareWith: null })
      await get().refreshDatasets()
      await get().selectDataset(merged.datasetId)
    } catch (e) {
      set({ error: message(e) })
    } finally {
      set({ busy: null })
    }
  },

  async updateSettings(settings) {
    set({ layoutSettings: { ...get().layoutSettings, ...settings } })
    await rebuildLayout(set, get)
  },

  selectNode: (nodeId) =>
    set({ selectedNodeId: get().selectedNodeId === nodeId ? null : nodeId }),

  async removeDataset(datasetId) {
    await api.unload(datasetId)
    if (get().activeDatasetId === datasetId) {
      set({ activeDatasetId: null, layout: null, organisms: [], activeOrganismId: null })
    }
    await get().refreshDatasets()
  },

  dismissError: () => set({ error: null }),
}))

function labelOf(state: AppState, datasetId: string): string {
  return state.datasets.find((d) => d.datasetId === datasetId)?.label ?? datasetId
}

type Setter = (partial: Partial<AppState>) => void

async function rebuildLayout(set: Setter, get: () => AppState): Promise<void> {
  const { activeDatasetId, activeOrganismId, layoutSettings, view, networkSettings } =
    get()
  if (activeDatasetId === null) {
    set({ layout: null, network: null, matrix: null, networkStats: null })
    return
  }

  const { scope } = get()
  const query = {
    datasetId: activeDatasetId,
    ...(activeOrganismId === null ? {} : { organismId: activeOrganismId }),
    ...(scope?.kind === 'publication' ? { publications: scope.keys } : {}),
    ...(scope?.kind === 'system' ? { systems: scope.keys } : {}),
  }

  set({ busy: view === 'center' ? 'Computing layout' : 'Building network' })
  try {
    if (view === 'center') {
      const layout = await api.centerLayout(query, {
        aggregateBelow: layoutSettings.aggregateBelow,
        multiMethod: layoutSettings.multiMethod,
      })
      set({ layout, error: null })
      return
    }

    // Score once, then filter: the threshold is a property of the evidence, so it has
    // to be applied after scoring rather than as a database predicate.
    const scored = await api.score({
      ...query,
      ...(networkSettings.physicalOnly ? { physicalOnly: true } : {}),
      excludeSelfInteractions: true,
    })
    const kept = scored.filter((p) => p.score >= networkSettings.minTrust)

    if (view === 'matrix') {
      const matrix = api.matrix(kept, { ordering: networkSettings.ordering })
      set({
        matrix,
        network: null,
        networkStats: {
          nodes: matrix.labels.length,
          edges: matrix.cells.length,
          hidden: scored.length - kept.length,
        },
        error: null,
      })
      return
    }

    const { focusId } = get()

    // Neither a focused protein nor a scoped publication applies the trust threshold:
    // both are requests to see a specific, bounded set of interactions in full, and
    // filtering there can empty the canvas while the panel still lists forty partners.
    // Trust stays visible as edge colour and weight instead.
    const unfiltered = focusId !== null || scope !== null

    // Build from the pairs already scored above rather than asking the database to
    // gather and score them again — the same work, and the slowest step there is. On
    // the full BioGRID release that saved eleven seconds on every rebuild.
    const full = api.graphFrom(unfiltered ? scored : kept)

    // Density limits are applied *within* the neighbourhood — capping globally first
    // would often remove the focus itself.
    const focusIndex = focusId === null ? undefined : full.index(focusId)
    const scoped =
      focusIndex === undefined
        ? full
        : full.induced(full.neighbourhood(focusIndex, networkSettings.focusDepth))

    const graph = scoped.reduce({
      maxEdges: networkSettings.maxEdges,
      ...(focusIndex === undefined && scope === null
        ? { minDegree: networkSettings.minDegree }
        : {}),
    })

    const centre = focusId === null ? undefined : graph.index(focusId)
    const network = api.networkLayout(graph, {
      mode: centre === undefined ? networkSettings.mode : 'ego',
      ...(centre === undefined ? {} : { focus: centre }),
    })
    set({
      network,
      matrix: null,
      networkStats: {
        nodes: network.nodes.length,
        edges: network.edges.length,
        // Focusing and scoping ignore the threshold, so nothing is hidden by it.
        hidden: unfiltered ? 0 : scored.length - kept.length,
      },
      error: null,
    })
  } catch (e) {
    set({ error: message(e), layout: null, network: null, matrix: null })
  } finally {
    set({ busy: null })
  }
}
