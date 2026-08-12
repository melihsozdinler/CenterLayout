import { useApp } from './store'
import type { NetworkLayoutMode } from '../views/network-layout'

/**
 * Layout switching, on the canvas rather than buried in the sidebar.
 *
 * Choosing a layout is not a setting you configure once; it is the main thing you do
 * while reading a network, because each arrangement answers a different question. It
 * belongs next to the drawing, always visible, one click away.
 */
const LAYOUTS: { mode: NetworkLayoutMode; label: string; answers: string }[] = [
  { mode: 'force', label: 'Force', answers: 'What clusters together?' },
  { mode: 'layered', label: 'Layered', answers: 'How many hops apart are these?' },
  { mode: 'grouped', label: 'Grouped', answers: 'What are the modules?' },
  { mode: 'circular', label: 'Circular', answers: 'A stable reference arrangement.' },
]

export function CanvasToolbar() {
  const view = useApp((s) => s.view)
  const mode = useApp((s) => s.networkSettings.mode)
  const updateNetwork = useApp((s) => s.updateNetwork)
  const network = useApp((s) => s.network)
  const focus = useApp((s) => s.focus)
  const focusId = useApp((s) => s.focusId)
  const focusHistory = useApp((s) => s.focusHistory)
  const focusProtein = useApp((s) => s.focusProtein)
  const focusBack = useApp((s) => s.focusBack)
  const scope = useApp((s) => s.scope)
  const scopeDetail = useApp((s) => s.scopeDetail)
  const setScope = useApp((s) => s.setScope)

  if (view !== 'network') return null

  // While focused the arrangement is the ego layout, which is the point of focusing;
  // the layout buttons apply to the whole network and would silently do nothing.
  const focused = focusId !== null

  return (
    <div className="canvas-toolbar">
      {scope && !focused && (
        <div className="crumbs">
          <button onClick={() => void setScope(null)} title="Back to the whole network">
            ← Whole network
          </button>
          <span className="crumb-current">
            {scope.kind === 'publication' ? '📄' : '🔬'} {scope.label}
          </span>
          {scopeDetail && (
            <span className="hint">
              {scopeDetail.proteinCount} proteins · {scopeDetail.interactionCount}{' '}
              interactions · {scopeDetail.systems.join(', ')}
            </span>
          )}
        </div>
      )}

      {focused && (
        <div className="crumbs">
          <button
            onClick={() => void focusProtein(null)}
            title="Back to the whole network"
          >
            ← Whole network
          </button>
          {focusHistory.length > 0 && (
            <button onClick={() => void focusBack()}>Back</button>
          )}
          <span className="crumb-current">{focus?.symbol ?? focusId}</span>
        </div>
      )}

      {!focused && (
        <div className="layout-picker" role="group" aria-label="Layout">
          {LAYOUTS.map((layout) => (
            <button
              key={layout.mode}
              className={mode === layout.mode ? 'active' : ''}
              aria-pressed={mode === layout.mode}
              title={layout.answers}
              onClick={() => void updateNetwork({ mode: layout.mode })}
            >
              {layout.label}
            </button>
          ))}
        </div>
      )}

      {!focused && network && network.mode !== mode && (
        <span className="toolbar-note">
          Showing {network.mode}: {mode} is not usable at{' '}
          {network.nodes.length.toLocaleString()} proteins.
        </span>
      )}
    </div>
  )
}
