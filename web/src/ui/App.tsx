import { useEffect, useState } from 'react'
import { APP_NAME, APP_VERSION } from '../app-info'
import { CenterView } from './CenterView'
import { NetworkView } from './NetworkView'
import { CanvasToolbar } from './CanvasToolbar'
import { ExternalPanel } from './ExternalPanel'
import { Sidebar } from './Sidebar'
import { useApp } from './store'

/** Application shell: dataset panel on the left, the center layout on the right. */
export function App() {
  const refreshDatasets = useApp((s) => s.refreshDatasets)
  const loadFile = useApp((s) => s.loadFile)
  const layout = useApp((s) => s.layout)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const networkStats = useApp((s) => s.networkStats)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // Pick up anything already in this browser's storage from a previous visit.
    void refreshDatasets()
  }, [refreshDatasets])

  return (
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) void loadFile(file)
      }}
    >
      <header className="app-header">
        <span className="app-title">
          {APP_NAME} <span className="app-version">{APP_VERSION}</span>
        </span>
        <span className="app-subtitle">
          Protein–Protein Interaction Literature Visualization
        </span>
        <nav className="view-tabs" aria-label="View">
          {(
            [
              ['center', 'Literature'],
              ['network', 'Network'],
              ['matrix', 'Matrix'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              className={view === kind ? 'active' : ''}
              aria-pressed={view === kind}
              onClick={() => void setView(kind)}
            >
              {label}
            </button>
          ))}
        </nav>

        {view === 'center' && layout && (
          <span className="app-counts">
            {layout.nodes.filter((n) => n.kind === 'publication').length.toLocaleString()}{' '}
            publications ·{' '}
            {layout.nodes
              .filter((n) => n.kind === 'system' || n.kind === 'aggregate')
              .length.toLocaleString()}{' '}
            methods
          </span>
        )}
        {view !== 'center' && networkStats && (
          <span className="app-counts">
            {networkStats.nodes.toLocaleString()} proteins ·{' '}
            {networkStats.edges.toLocaleString()} interactions
            {networkStats.hidden > 0 &&
              ` · ${networkStats.hidden.toLocaleString()} below threshold`}
          </span>
        )}
      </header>

      <aside className="app-sidebar" aria-label="Datasets and filters">
        <Sidebar />
      </aside>

      <main className="app-main" aria-label="Visualization">
        <CanvasToolbar />
        {view === 'center' ? <CenterView /> : <NetworkView />}
        <ExternalPanel />
      </main>

      <footer className="app-footer">
        Runs entirely in your browser. No data leaves this machine unless you enable
        online mode.
      </footer>
    </div>
  )
}
