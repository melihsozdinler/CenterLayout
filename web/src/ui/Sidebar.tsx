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
          <a
            href="https://downloads.thebiogrid.org/BioGRID"
            target="_blank"
            rel="noreferrer"
          >
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
              void state.selectOrganism(
                e.target.value === '' ? null : Number(e.target.value),
              )
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

      {state.view !== 'center' && state.activeDatasetId && (
        <section className="panel">
          <h2>Network</h2>

          <label>
            Minimum trust: <strong>{state.networkSettings.minTrust.toFixed(2)}</strong>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={state.networkSettings.minTrust}
              onChange={(e) =>
                void state.updateNetwork({ minTrust: Number(e.target.value) })
              }
            />
          </label>
          <p className="hint">
            Most reported interactions rest on a single publication. Raising this shows
            what survives if you only believe replicated evidence.
          </p>

          {state.view === 'network' && (
            <>
              <label>
                Arrangement
                <select
                  value={state.networkSettings.mode}
                  onChange={(e) =>
                    void state.updateNetwork({
                      mode: e.target.value as 'force' | 'grouped' | 'circular',
                    })
                  }
                >
                  <option value="force">Force-directed</option>
                  <option value="grouped">Modules on a ring</option>
                  <option value="circular">Single ring</option>
                </select>
              </label>

              <label>
                Colour by
                <select
                  value={state.networkSettings.colourBy}
                  onChange={(e) =>
                    void state.updateNetwork({
                      colourBy: e.target.value as 'trust' | 'module' | 'degree',
                    })
                  }
                >
                  <option value="trust">Trust</option>
                  <option value="module">Connected module</option>
                  <option value="degree">Number of partners</option>
                </select>
              </label>
            </>
          )}

          {state.view === 'matrix' && (
            <label>
              Row order
              <select
                value={state.networkSettings.ordering}
                onChange={(e) =>
                  void state.updateNetwork({
                    ordering: e.target.value as
                      'cluster' | 'degree' | 'core' | 'component' | 'alphabetical',
                  })
                }
              >
                <option value="cluster">Clustered (complexes on the diagonal)</option>
                <option value="degree">Most partners first</option>
                <option value="core">Densest first (k-core)</option>
                <option value="component">By connected module</option>
                <option value="alphabetical">Alphabetical</option>
              </select>
            </label>
          )}

          <label className="checkbox">
            <input
              type="checkbox"
              checked={state.networkSettings.physicalOnly}
              onChange={(e) =>
                void state.updateNetwork({ physicalOnly: e.target.checked })
              }
            />
            Physical interactions only
          </label>
        </section>
      )}

      {state.datasets.length > 1 && (
        <section className="panel">
          <h2>Compare &amp; merge</h2>
          <select
            value={state.compareWith ?? ''}
            onChange={(e) =>
              void state.compareTo(e.target.value === '' ? null : e.target.value)
            }
          >
            <option value="">Compare with…</option>
            {state.datasets
              .filter((d) => d.datasetId !== state.activeDatasetId)
              .map((d) => (
                <option key={d.datasetId} value={d.datasetId}>
                  {d.label}
                </option>
              ))}
          </select>

          {state.comparison && (
            <>
              <table className="compare">
                <tbody>
                  <tr>
                    <th>Only in {state.comparison.summary.leftLabel}</th>
                    <td>{state.comparison.summary.leftOnly.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <th>Only in {state.comparison.summary.rightLabel}</th>
                    <td>{state.comparison.summary.rightOnly.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <th>In both</th>
                    <td>{state.comparison.summary.shared.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <th>Agreement</th>
                    <td>{(state.comparison.summary.jaccard * 100).toFixed(1)}%</td>
                  </tr>
                  {state.comparison.summary.sharedWithNewEvidence > 0 && (
                    <tr>
                      <th>Shared, new evidence</th>
                      <td>
                        {state.comparison.summary.sharedWithNewEvidence.toLocaleString()}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="hint">
                Compared by BioGRID gene id. Merging keeps one copy of records present in
                both, so replication counts are not inflated.
              </p>
              <button onClick={() => void state.mergeWith(state.compareWith!)}>
                Merge into a new dataset
              </button>
            </>
          )}
        </section>
      )}

      {state.view === 'center' && state.layout && (
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
