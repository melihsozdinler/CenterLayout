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
  const grouping = useApp((s) => s.networkSettings.grouping)
  const setGrouping = useApp((s) => s.setGrouping)
  const drill = useApp((s) => s.drill)
  const drillTo = useApp((s) => s.drillTo)
  const highLevel = useApp((s) => s.highLevel)
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

  const modules = grouping === 'modules'

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

      {/*
        The level trail. Opening a module that is itself too large contracts it again,
        so this can be several deep — and a reader who cannot see how far in they are,
        or get back out, is lost rather than exploring.
      */}
      {modules && !focused && (
        <div className="crumbs drill">
          <button
            onClick={() => void drillTo(0)}
            disabled={drill.length === 0}
            title="Back to the whole network"
          >
            ← Whole network
          </button>
          {drill.map((level, depth) => (
            <span key={`${depth}-${level.id}`} className="crumb">
              <span className="crumb-sep">›</span>
              {depth === drill.length - 1 ? (
                <span className="crumb-current">
                  {level.label} ({level.size.toLocaleString()})
                </span>
              ) : (
                <button className="link" onClick={() => void drillTo(depth + 1)}>
                  {level.label}
                </button>
              )}
            </span>
          ))}
          {highLevel && (
            <span className="hint">
              {highLevel.nodes.length} modules · {highLevel.proteinCount.toLocaleString()}{' '}
              proteins · click one to open it
            </span>
          )}
          {!highLevel && drill.length > 0 && (
            <span className="hint">small enough to draw as proteins</span>
          )}
        </div>
      )}

      {!focused && (
        <div className="layout-picker" role="group" aria-label="Layout">
          {LAYOUTS.map((layout) => (
            <button
              key={layout.mode}
              className={!modules && mode === layout.mode ? 'active' : ''}
              aria-pressed={!modules && mode === layout.mode}
              title={layout.answers}
              // One update, not two: switching back to proteins and choosing the
              // arrangement in separate actions would start two rebuilds racing, and
              // whichever finished last would win.
              onClick={() =>
                void updateNetwork({
                  mode: layout.mode,
                  ...(modules ? { grouping: 'proteins' as const } : {}),
                })
              }
            >
              {layout.label}
            </button>
          ))}
          <button
            className={modules ? 'active' : ''}
            aria-pressed={modules}
            title="Draw the modules instead of the proteins, and open any of them."
            onClick={() => void setGrouping(modules ? 'proteins' : 'modules')}
          >
            Modules
          </button>
        </div>
      )}

      {!focused && !modules && network && network.mode !== mode && (
        <span className="toolbar-note">
          Showing {network.mode}: {mode} is not usable at{' '}
          {network.nodes.length.toLocaleString()} proteins.
        </span>
      )}
    </div>
  )
}
