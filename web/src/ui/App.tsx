import { APP_NAME, APP_VERSION } from '../app-info'

/**
 * Application shell. Later phases mount the dataset sidebar into <aside> and the
 * view switcher into <main>; this file stays a thin frame around them.
 */
export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">
          {APP_NAME} <span className="app-version">{APP_VERSION}</span>
        </span>
        <span className="app-subtitle">
          Protein–Protein Interaction Literature Visualization
        </span>
      </header>

      <aside className="app-sidebar" aria-label="Datasets and filters">
        <p className="placeholder">Dataset panel — Phase 2.</p>
      </aside>

      <main className="app-main" aria-label="Visualization">
        <p className="placeholder">Visualization canvas — Phase 6.</p>
      </main>

      <footer className="app-footer">
        Runs entirely in your browser. No data leaves this machine unless you enable
        online mode.
      </footer>
    </div>
  )
}
