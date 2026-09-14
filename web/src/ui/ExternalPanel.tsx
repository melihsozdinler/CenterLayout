import { useApp } from './store'

/**
 * A database page shown beside the network.
 *
 * A blocked frame renders blank and fires no event we can catch, so rather than
 * pretending to detect the failure there is always a visible way out to a real tab.
 * Which sites permit framing is declared per resource in `external/resources.ts`.
 */
export function ExternalPanel() {
  const open = useApp((s) => s.openResource)
  const close = useApp((s) => s.closeExternal)

  if (!open) return null
  const { resource, url } = open

  return (
    <aside className="external-panel" aria-label={`${resource.name} page`}>
      <header>
        <strong>{resource.name}</strong>
        <div>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open in a tab ↗
          </a>
          <button onClick={close} aria-label="Close">
            ×
          </button>
        </div>
      </header>

      {resource.display === 'image' ? (
        <div className="external-image">
          <img src={url} alt={`${resource.name} network`} />
        </div>
      ) : (
        <iframe
          src={url}
          title={resource.name}
          // Third-party content: deny it same-origin access to this page, and to
          // top-level navigation, while still allowing the page to work.
          sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      )}

      <footer className="hint">
        Loaded from {new URL(url).hostname}. If this stays blank, the site is refusing to
        be embedded — use the tab link above.
      </footer>
    </aside>
  )
}
