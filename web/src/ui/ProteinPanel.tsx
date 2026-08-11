import { useState } from 'react'
import { useApp } from './store'

/**
 * The protein a click opened: who it interacts with, and on whose authority.
 *
 * Partners are ordered by how many publications support them, because that is the
 * question a reader has first — which of these should I believe?
 */
export function ProteinPanel() {
  const focus = useApp((s) => s.focus)
  const focusProtein = useApp((s) => s.focusProtein)
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!focus) return null

  return (
    <section className="panel protein">
      <div className="protein-head">
        <h2>{focus.symbol ?? `BioGRID ${focus.biogridId}`}</h2>
        <button
          className="remove"
          aria-label="Close"
          onClick={() => void focusProtein(null)}
        >
          ×
        </button>
      </div>

      <p className="hint">
        {focus.organism ?? 'unknown organism'}
        {focus.synonyms.length > 0 && ` · also ${focus.synonyms.slice(0, 3).join(', ')}`}
      </p>
      <p className="hint">
        <strong>{focus.partnerCount.toLocaleString()}</strong> interaction partners. All
        of them are drawn while a protein is focused — the trust threshold shows as edge
        colour and weight here rather than hiding anything.
      </p>

      <ul className="partners">
        {focus.partners.slice(0, 200).map((partner) => {
          const open = expanded === partner.pairKey
          return (
            <li key={partner.pairKey}>
              <button
                className="partner-row"
                onClick={() => setExpanded(open ? null : partner.pairKey)}
              >
                <span className="partner-name">
                  {partner.partnerSymbol ?? partner.partnerId}
                  {partner.hasGenetic && !partner.hasPhysical && (
                    <em title="Genetic interaction: not evidence of physical contact">
                      {' '}
                      genetic
                    </em>
                  )}
                </span>
                <span className="partner-counts">
                  {partner.publicationCount} pub · {partner.systemCount} method
                  {partner.systemCount === 1 ? '' : 's'}
                </span>
              </button>

              {open && (
                <div className="partner-detail">
                  <div>
                    <strong>Methods</strong>
                    <span>{partner.systems.join(', ')}</span>
                  </div>
                  <div>
                    <strong>Publications</strong>
                    <span>
                      {partner.publications.slice(0, 8).join('; ')}
                      {partner.publications.length > 8 &&
                        ` +${partner.publications.length - 8} more`}
                    </span>
                  </div>
                  <div>
                    <strong>Years</strong>
                    <span>
                      {partner.firstYear ?? '?'}
                      {partner.lastYear !== partner.firstYear && `–${partner.lastYear}`}
                    </span>
                  </div>
                  <div>
                    <strong>Throughput</strong>
                    <span>
                      {partner.lowThroughput} low · {partner.highThroughput} high
                    </span>
                  </div>
                  <button onClick={() => void focusProtein(partner.partnerId)}>
                    Centre on {partner.partnerSymbol ?? partner.partnerId}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {focus.partners.length > 200 && (
        <p className="hint">Showing the 200 best-supported of {focus.partners.length}.</p>
      )}
    </section>
  )
}
