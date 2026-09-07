import { useEffect, useRef, useState } from 'react'
import { useApp } from './store'
import { api } from '../api'
import { CollectionPanel, LiteraturePanel } from './LiteraturePanel'
import { ProteinPanel } from './ProteinPanel'

export function Sidebar() {
  const state = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')

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

      {state.activeDatasetId && (
        <section className="panel">
          <h2>Find a protein</h2>
          <input
            type="search"
            placeholder="Gene symbol, e.g. TP53"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              void state.searchProteins(e.target.value)
            }}
          />
          {state.searchResults.length > 0 && (
            <ul className="search-results">
              {state.searchResults.map((hit) => (
                <li key={hit.biogridId}>
                  <button
                    onClick={() => {
                      setSearch('')
                      void state.searchProteins('')
                      void state.focusProtein(hit.biogridId)
                    }}
                  >
                    <strong>{hit.symbol}</strong>
                    <span className="hint">{hit.organism ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <LiteraturePanel />

      <CollectionPanel />

      <ProteinPanel />

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

          <h2 style={{ marginTop: 16 }}>Density</h2>

          {state.focusId !== null ? (
            <label>
              Hops from {state.focus?.symbol ?? 'the centre'}:{' '}
              <strong>{state.networkSettings.focusDepth}</strong>
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={state.networkSettings.focusDepth}
                onChange={(e) =>
                  void state.updateNetwork({ focusDepth: Number(e.target.value) })
                }
              />
            </label>
          ) : (
            <label>
              Minimum partners per protein:{' '}
              <strong>{state.networkSettings.minDegree}</strong>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={state.networkSettings.minDegree}
                onChange={(e) =>
                  void state.updateNetwork({ minDegree: Number(e.target.value) })
                }
              />
            </label>
          )}

          <label>
            Interactions drawn:{' '}
            <strong>{state.networkSettings.maxEdges.toLocaleString()}</strong>
            <input
              type="range"
              min={200}
              max={20000}
              step={200}
              value={state.networkSettings.maxEdges}
              onChange={(e) =>
                void state.updateNetwork({ maxEdges: Number(e.target.value) })
              }
            />
          </label>
          <p className="hint">
            Keeps the best-supported interactions. A protein can look unconnected because
            its interactions lost a global race, so prefer the trust threshold when you
            want an honest cut.
          </p>
        </section>
      )}

      <ResourceEditor />

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

      {state.view === 'center' && state.layout && <PublicationFilter />}

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

/**
 * Editing the links out to other databases.
 *
 * Which databases matter depends on the organism and the question, so the list is the
 * user's rather than ours — base URL and template are both editable, and anything
 * added persists in this browser.
 */
/**
 * Which publications the center layout draws.
 *
 * Every publication is one node here regardless of what it reported, so a screen
 * contributing ten thousand interactions and a structure paper contributing one look
 * alike until you ask. These three questions are the ones that separate them: how much
 * a paper contributed, how much of the proteome it touched, and how it looked.
 *
 * Bounds are the range of the *unfiltered* literature, so the numbers beside each box
 * stay put while you narrow the view.
 */
function PublicationFilter() {
  const layout = useApp((s) => s.layout)
  const settings = useApp((s) => s.layoutSettings)
  const systems = useApp((s) => s.systems)
  const updateSettings = useApp((s) => s.updateSettings)

  const filter = layout?.filter
  if (!filter) return null

  // What is on the canvas, which is not always what matched: the publication band is
  // bounded, so a literature larger than it fits keeps its biggest contributors and
  // leaves the rest undrawn. In duplicate mode one publication is several nodes, hence
  // the distinct keys.
  const drawn = new Set(
    layout.nodes
      .filter((node) => node.kind === 'publication')
      .map((node) => node.id.split('@')[0]),
  ).size
  const undrawn = Math.max(0, filter.publicationsAfter - drawn)

  const active =
    settings.minInteractions !== null ||
    settings.maxInteractions !== null ||
    settings.minProteins !== null ||
    settings.maxProteins !== null ||
    settings.systems !== null

  const toggleSystem = (name: string) => {
    const chosen = settings.systems
    if (chosen === null) {
      // Nothing chosen means everything; the first click means "only this one",
      // which is what a reader who clicks a method is asking for.
      void updateSettings({ systems: [name] })
      return
    }
    const next = chosen.includes(name)
      ? chosen.filter((s) => s !== name)
      : [...chosen, name]
    void updateSettings({ systems: next.length === 0 ? null : next })
  }

  return (
    <section className="panel filter">
      <h2>
        Filter publications
        {active && (
          <button
            className="link clear"
            onClick={() =>
              void updateSettings({
                minInteractions: null,
                maxInteractions: null,
                minProteins: null,
                maxProteins: null,
                systems: null,
              })
            }
          >
            clear
          </button>
        )}
      </h2>

      <p className="hint">
        Drawing <strong>{drawn.toLocaleString()}</strong> of{' '}
        {filter.publicationsBefore.toLocaleString()} publications. Counted within this
        organism and the methods selected — the same quantity the node sizes encode, so
        a paper's total across the whole release can be larger.
        {filter.publicationsAfter === 0 && ' Nothing matches — widen a bound.'}
      </p>

      {undrawn > 0 && (
        <p className="hint warn">
          {undrawn.toLocaleString()} more match than the publication band can hold, so the
          smallest contributors are not drawn. Narrow a bound to see them.
        </p>
      )}

      <Bound
        label="Interactions per publication"
        range={filter.interactionRange}
        min={settings.minInteractions}
        max={settings.maxInteractions}
        onChange={(min, max) =>
          void updateSettings({ minInteractions: min, maxInteractions: max })
        }
      />

      <Bound
        label="Proteins per publication"
        range={filter.proteinRange}
        min={settings.minProteins}
        max={settings.maxProteins}
        onChange={(min, max) =>
          void updateSettings({ minProteins: min, maxProteins: max })
        }
      />

      {systems.length > 0 && (
        <div className="method-filter">
          <div className="method-head">
            Methods
            <span className="hint">
              {settings.systems === null
                ? `all ${systems.length}`
                : `${settings.systems.length} of ${systems.length}`}
            </span>
          </div>
          <ul className="method-list">
            {systems.map((system) => {
              const checked =
                settings.systems === null || settings.systems.includes(system.name)
              return (
                <li key={system.name}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSystem(system.name)}
                    />
                    <span className={system.type === 'genetic' ? 'genetic' : ''}>
                      {system.name}
                    </span>
                    <span className="hint">
                      {system.publicationCount.toLocaleString()}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {settings.systems !== null && (
            <button
              className="link"
              onClick={() => void updateSettings({ systems: null })}
            >
              select all
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * A min/max pair.
 *
 * Committed on blur or Enter rather than on every keystroke: each change re-queries the
 * release, and typing "1000" would otherwise run four of them, the first three for
 * numbers the user never meant.
 */
function Bound({
  label,
  range,
  min,
  max,
  onChange,
}: {
  label: string
  range: readonly [number, number]
  min: number | null
  max: number | null
  onChange: (min: number | null, max: number | null) => void
}) {
  const [lo, setLo] = useState(min === null ? '' : String(min))
  const [hi, setHi] = useState(max === null ? '' : String(max))

  // Follow the store when the bound changes from somewhere else — clearing the filter,
  // or a manifest being restored. Without this the boxes keep showing numbers that are
  // no longer in force, which is worse than showing nothing.
  useEffect(() => setLo(min === null ? '' : String(min)), [min])
  useEffect(() => setHi(max === null ? '' : String(max)), [max])

  const parse = (text: string): number | null => {
    const value = Number(text.trim())
    return text.trim() === '' || !Number.isFinite(value) ? null : Math.max(0, value)
  }
  const commit = () => onChange(parse(lo), parse(hi))

  return (
    <div className="bound">
      <div className="bound-label">{label}</div>
      <div className="bound-inputs">
        <input
          type="number"
          min={0}
          value={lo}
          placeholder={String(range[0])}
          aria-label={`${label}, at least`}
          onChange={(e) => setLo(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <span>to</span>
        <input
          type="number"
          min={0}
          value={hi}
          placeholder={String(range[1])}
          aria-label={`${label}, at most`}
          onChange={(e) => setHi(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </div>
      <p className="hint">
        {range[0].toLocaleString()}–{range[1].toLocaleString()} in this literature.
      </p>
    </div>
  )
}

function ResourceEditor() {
  const resources = useApp((s) => s.resources)
  const updateResources = useApp((s) => s.updateResources)
  const restoreResources = useApp((s) => s.restoreResources)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ name: '', baseUrl: '', template: '' })

  return (
    <section className="panel">
      <h2>
        <button className="link" onClick={() => setOpen(!open)}>
          External databases ({resources.length}) {open ? '▾' : '▸'}
        </button>
      </h2>

      {open && (
        <>
          <ul className="resource-list">
            {resources.map((resource) => (
              <li key={resource.id}>
                <span>
                  <strong>{resource.name}</strong>
                  <span className="hint">
                    {resource.display === 'embed'
                      ? 'shown in panel'
                      : resource.display === 'image'
                        ? 'image'
                        : 'new tab'}
                  </span>
                </span>
                <button
                  className="remove"
                  aria-label={`Remove ${resource.name}`}
                  onClick={() =>
                    updateResources(resources.filter((r) => r.id !== resource.id))
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <label>
            Name
            <input
              type="text"
              value={draft.name}
              placeholder="Reactome"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Base URL
            <input
              type="text"
              value={draft.baseUrl}
              placeholder="https://reactome.org"
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </label>
          <label>
            Template
            <input
              type="text"
              value={draft.template}
              placeholder="/content/query?q={symbol}"
              onChange={(e) => setDraft({ ...draft, template: e.target.value })}
            />
          </label>
          <p className="hint">
            Placeholders: {'{symbol}'} {'{biogridId}'} {'{entrez}'} {'{swissprot}'}{' '}
            {'{organismId}'} {'{systematic}'}
          </p>

          <button
            onClick={() => {
              if (!draft.name.trim() || !draft.baseUrl.trim()) return
              updateResources([
                ...resources,
                {
                  id: `user-${draft.name.toLowerCase().replace(/\W+/g, '-')}-${resources.length}`,
                  name: draft.name.trim(),
                  baseUrl: draft.baseUrl.trim(),
                  template: draft.template.trim() || '/',
                  // New tab by default: most sites refuse framing, and a blank panel
                  // is a worse first impression than a working link.
                  display: 'tab',
                  requires: [],
                },
              ])
              setDraft({ name: '', baseUrl: '', template: '' })
            }}
          >
            Add
          </button>
          <button onClick={restoreResources}>Restore defaults</button>
        </>
      )}
    </section>
  )
}
