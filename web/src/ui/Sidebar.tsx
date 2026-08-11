import { useRef } from 'react'
import { useApp } from './store'
import { api } from '../api'

export function Sidebar() {
  const state = useApp()
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <>
      <section className="panel">
        <h2>Data</h2>
        <button className="primary" onClick={() => fileInput.current?.click()}>
          Open a BioGRID file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,.txt,.tsv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void state.loadFile(file)
            e.target.value = ''
          }}
        />
        <p className="hint">
          Download <code>BIOGRID-ORGANISM-LATEST.tab3.zip</code> from{' '}
          <a href="https://downloads.thebiogrid.org/BioGRID" target="_blank" rel="noreferrer">
            thebiogrid.org
          </a>
          . Files are read on this machine and never uploaded.
        </p>
      </section>

      {state.busy && (
        <section className="panel status" aria-live="polite">
          <strong>{state.busy}</strong>
          {state.progress && (
            <>
              <div className="bar">
                <i style={{ width: `${(state.progress.fraction ?? 0) * 100}%` }} />
              </div>
              <span className="hint">{state.progress.message}</span>
            </>
          )}
        </section>
      )}

      {state.warning && (
        <section className="panel warning">
          <strong>Data will not be saved</strong>
          <p>{state.warning}</p>
        </section>
      )}

      {state.error && (
        <section className="panel error" role="alert">
          <strong>Could not load that file</strong>
          <p>{state.error}</p>
          <button onClick={state.dismissError}>Dismiss</button>
        </section>
      )}

      {state.pendingEntries && (
        <section className="panel">
          <h2>Choose an organism file</h2>
          <p className="hint">
            This archive contains {state.pendingEntries.entries.length} files, one per
            organism.
          </p>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void state.chooseEntry(e.target.value)
            }}
          >
            <option value="" disabled>
              Select…
            </option>
            {state.pendingEntries.entries.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name.replace(/^BIOGRID-ORGANISM-/, '').replace(/\.tab3\.txt$/, '')}
              </option>
            ))}
          </select>
          <button onClick={state.cancelEntryChoice}>Cancel</button>
        </section>
      )}

      {state.datasets.length > 0 && (
        <section className="panel">
          <h2>Datasets</h2>
          <ul className="dataset-list">
            {state.datasets.map((dataset) => (
              <li
                key={dataset.datasetId}
                className={dataset.datasetId === state.activeDatasetId ? 'active' : ''}
              >
                <button onClick={() => void state.selectDataset(dataset.datasetId)}>
                  <strong>{dataset.label}</strong>
                  <span className="hint">
                    {dataset.recordCount.toLocaleString()} records ·{' '}
                    {dataset.pairCount.toLocaleString()} interactions ·{' '}
                    {dataset.publicationCount.toLocaleString()} publications
                  </span>
                </button>
                <button
                  className="remove"
                  aria-label={`Remove ${dataset.label}`}
                  onClick={() => void state.removeDataset(dataset.datasetId)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.organisms.length > 0 && (
        <section className="panel">
          <h2>Organism</h2>
          <select
            value={state.activeOrganismId ?? ''}
            onChange={(e) =>
              void state.selectOrganism(e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">All organisms in this dataset</option>
            {state.organisms.map((organism) => (
              <option key={organism.organismId} value={organism.organismId}>
                {organism.name} ({organism.recordCount.toLocaleString()})
              </option>
            ))}
          </select>
        </section>
      )}

      {state.layout && (
        <section className="panel">
          <h2>Layout</h2>

          <label>
            Fold methods with fewer than{' '}
            <input
              type="number"
              min={0}
              max={50}
              value={state.layoutSettings.aggregateBelow}
              onChange={(e) =>
                void state.updateSettings({ aggregateBelow: Number(e.target.value) })
              }
            />{' '}
            publications
          </label>
          <p className="hint">Zero keeps every method separate.</p>

          <label>
            Publications using several methods
            <select
              value={state.layoutSettings.multiMethod}
              onChange={(e) =>
                void state.updateSettings({
                  multiMethod: e.target.value as 'circular-mean' | 'duplicate',
                })
              }
            >
              <option value="circular-mean">Placed once, between their methods</option>
              <option value="duplicate">Duplicated into each method</option>
            </select>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={state.layoutSettings.showPublicationLabels}
              onChange={(e) =>
                void state.updateSettings({ showPublicationLabels: e.target.checked })
              }
            />
            Label publications when sparse
          </label>

          <button
            onClick={() => {
              const layout = state.layout
              if (!layout) return
              const svg = api.toSvg(api.centerScene(layout), 'ProLiVis center layout')
              const blob = new Blob([svg], { type: 'image/svg+xml' })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = 'prolivis-center-layout.svg'
              anchor.click()
              URL.revokeObjectURL(url)
            }}
          >
            Export figure as SVG
          </button>
        </section>
      )}
    </>
  )
}
