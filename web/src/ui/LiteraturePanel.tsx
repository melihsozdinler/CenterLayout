import { api } from '../api'
import { useApp } from './store'

/**
 * Searching the literature, and going from a paper to what it reported.
 *
 * ProLiVis 1.0 had this as a completer over its publication column and a "Visualize"
 * button. The move it enables is the whole point of a literature-centric tool: pick a
 * paper, see its network. What is new is that the search reaches PubMed ids, DOIs and
 * enriched titles rather than only the author-year label, and that the result says how
 * much each paper actually contributed before you commit to opening it.
 */
export function LiteraturePanel() {
  const datasetId = useApp((s) => s.activeDatasetId)
  const results = useApp((s) => s.literatureResults)
  const searchLiterature = useApp((s) => s.searchLiterature)
  const setScope = useApp((s) => s.setScope)
  const scope = useApp((s) => s.scope)
  // The query lives in the store so that changing dataset or organism refreshes the
  // list without this component having to observe it.
  const query = useApp((s) => s.literatureQuery)

  if (!datasetId) return null

  return (
    <section className="panel">
      <h2>Find literature</h2>
      <input
        type="search"
        placeholder="Author, year, PubMed id, DOI or title"
        value={query}
        onChange={(e) => void searchLiterature(e.target.value)}
      />
      {query === '' && results.length > 0 && (
        <p className="hint">Largest contributors to this dataset.</p>
      )}

      <ul className="literature-results">
        {results.map((hit) => {
          const url = api.publicationUrl(hit.refKind, hit.refId)
          const active =
            scope?.kind === 'publication' && scope.keys[0] === hit.publicationKey
          return (
            <li key={hit.publicationKey} className={active ? 'active' : ''}>
              <button
                onClick={() =>
                  void setScope({
                    kind: 'publication',
                    keys: [hit.publicationKey],
                    label: hit.label,
                  })
                }
                title={hit.title ?? 'Show this publication’s interaction network'}
              >
                <strong>{hit.label}</strong>
                {hit.title && <span className="lit-title">{hit.title}</span>}
                <span className="hint">
                  {hit.interactionCount.toLocaleString()} interactions · {hit.systemCount}{' '}
                  method{hit.systemCount === 1 ? '' : 's'}
                </span>
              </button>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
                  ↗
                </a>
              )}
            </li>
          )
        })}
      </ul>

      {results.length === 0 && query !== '' && (
        <p className="hint">No publication matches “{query}”.</p>
      )}
    </section>
  )
}
