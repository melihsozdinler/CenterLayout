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
import type { IngestProgress } from '../data/ingest'
import type { ZipEntry } from '../data/zip'

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

  layout: CenterLayoutResult | null
  layoutSettings: LayoutSettings
  selectedNodeId: string | null

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
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const useApp = create<AppState>((set, get) => ({
  datasets: [],
  activeDatasetId: null,
  organisms: [],
  activeOrganismId: null,
  layout: null,
  layoutSettings: {
    aggregateBelow: 0,
    multiMethod: 'circular-mean',
    showPublicationLabels: true,
  },
  selectedNodeId: null,
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
      await get().selectDataset(result.datasetId)
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
    set({ activeDatasetId: datasetId, selectedNodeId: null, layout: null })
    if (datasetId === null) {
      set({ organisms: [], activeOrganismId: null })
      return
    }
    const organisms = await api.organisms(datasetId)
    set({ organisms })
    // Default to the most abundant organism: the whole-dataset view of a
    // cross-species set is rarely what anyone means.
    await get().selectOrganism(organisms[0]?.organismId ?? null)
  },

  async selectOrganism(organismId) {
    set({ activeOrganismId: organismId, selectedNodeId: null })
    await rebuildLayout(set, get)
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

type Setter = (partial: Partial<AppState>) => void

async function rebuildLayout(set: Setter, get: () => AppState): Promise<void> {
  const { activeDatasetId, activeOrganismId, layoutSettings } = get()
  if (activeDatasetId === null) {
    set({ layout: null })
    return
  }

  set({ busy: 'Computing layout' })
  try {
    const layout = await api.centerLayout(
      {
        datasetId: activeDatasetId,
        ...(activeOrganismId === null ? {} : { organismId: activeOrganismId }),
      },
      {
        aggregateBelow: layoutSettings.aggregateBelow,
        multiMethod: layoutSettings.multiMethod,
      },
    )
    set({ layout, error: null })
  } catch (e) {
    set({ error: message(e), layout: null })
  } finally {
    set({ busy: null })
  }
}
