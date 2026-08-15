import { useState } from 'react'
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
  const collected = useApp((s) => s.collected)
  const toggleCollected = useApp((s) => s.toggleCollected)

  if (!datasetId) return null

  const inCollection = (key: string) => collected.some((c) => c.publicationKey === key)

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
              <input
                type="checkbox"
                checked={inCollection(hit.publicationKey)}
                onChange={() => toggleCollected(hit)}
                aria-label={`Collect ${hit.label}`}
                title="Add to the collection"
              />
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

/**
 * The gathered publications, and what can be done with them.
 *
 * Visualising the collection is a view — it lasts as long as you look at it. Saving it
 * makes an object: a dataset that can be scored, compared, merged, exported and
 * reopened, carrying a record of which publications produced it. A network assembled
 * from a chosen slice of the literature is a claim about that slice, and one that
 * cannot say what it was built from is not reproducible.
 */
export function CollectionPanel() {
  const collected = useApp((s) => s.collected)
  const toggleCollected = useApp((s) => s.toggleCollected)
  const clearCollection = useApp((s) => s.clearCollection)
  const visualizeCollection = useApp((s) => s.visualizeCollection)
  const saveCollection = useApp((s) => s.saveCollection)
  const [name, setName] = useState('')

  if (collected.length === 0) return null

  const interactions = collected.reduce((sum, c) => sum + c.interactionCount, 0)

  return (
    <section className="panel collection">
      <h2>
        Collection ({collected.length})
        <button className="link clear" onClick={clearCollection}>
          clear
        </button>
      </h2>

      <ul className="collected-list">
        {collected.map((hit) => (
          <li key={hit.publicationKey}>
            <span>
              <strong>{hit.label}</strong>
              <span className="hint">
                {hit.interactionCount.toLocaleString()} interactions
              </span>
            </span>
            <button
              className="remove"
              aria-label={`Remove ${hit.label}`}
              onClick={() => toggleCollected(hit)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <p className="hint">
        Up to {interactions.toLocaleString()} interactions before overlaps are merged — an
        interaction reported by two of these papers is one interaction with two pieces of
        evidence.
      </p>

      <button className="primary" onClick={() => void visualizeCollection()}>
        Visualize combined network
      </button>

      <label>
        Save as a dataset
        <input
          type="text"
          value={name}
          placeholder="e.g. SARS-CoV-2 interactome screens"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <button onClick={() => void saveCollection(name)}>Save</button>
    </section>
  )
}
