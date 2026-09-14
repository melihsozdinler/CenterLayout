/**
 * Links out to the databases a protein also lives in.
 *
 * ProLiVis 1.0 had this — BioGRID, UniProt, AmiGO and STRING URLs in
 * `layoutwidget.cpp` — but every line was commented out when QtWebKit was dropped from
 * Qt 5, so the feature died with the toolkit. Restoring it in a browser is
 * straightforward; making it *configurable* is the part worth doing, because which
 * databases matter depends on the organism and the question, and hard-coding four of
 * them repeats the original mistake in a new language.
 *
 * How a resource can be shown is a property of the site, not a preference:
 *
 *   - `tab`   always works, and is the only thing that always works.
 *   - `embed` works only where the site permits framing. Verified 2026-08-12:
 *             BioGRID, UniProt and IntAct send no `X-Frame-Options`; AmiGO sends
 *             `DENY`; STRING's pages sit behind a Cloudflare challenge that frames
 *             as `SAMEORIGIN`. A blocked frame renders blank with no event we can
 *             catch, so `embed` is declared per resource rather than attempted
 *             hopefully.
 *   - `image` is for endpoints returning an image directly. STRING's network API
 *             does, which is how 1.0 showed STRING and how we do again.
 *
 * These are third-party sites: opening one sends the protein identifier to them.
 * Nothing is contacted until the user asks.
 */

export type ResourceDisplay = 'tab' | 'embed' | 'image'

export interface ExternalResource {
  readonly id: string
  readonly name: string
  /** Site root, kept separate so a mirror or a versioned host can be swapped. */
  readonly baseUrl: string
  /**
   * Path and query appended to `baseUrl`, with `{placeholders}` substituted.
   * Available: symbol, biogridId, entrez, systematic, swissprot, organismId,
   * organismName, partnerSymbol.
   */
  readonly template: string
  readonly display: ResourceDisplay
  /** Placeholders that must resolve, or the link is not offered. */
  readonly requires: readonly string[]
  readonly note?: string
  /** False for user-added entries, which can be deleted. */
  readonly builtin?: boolean
}

/**
 * The defaults. Every URL here was checked against the live site on 2026-08-12; the
 * `display` values are what the sites actually permit, not what would be convenient.
 */
export const DEFAULT_RESOURCES: readonly ExternalResource[] = [
  {
    id: 'biogrid',
    name: 'BioGRID',
    baseUrl: 'https://thebiogrid.org',
    template: '/{biogridId}',
    display: 'embed',
    requires: ['biogridId'],
    note: 'The source of the data in this tool.',
    builtin: true,
  },
  {
    id: 'string-image',
    name: 'STRING network',
    baseUrl: 'https://string-db.org',
    template:
      '/api/image/network?identifiers={symbol}&species={organismId}&network_flavor=evidence',
    display: 'image',
    requires: ['symbol', 'organismId'],
    note: 'STRING blocks framing, so its network image is shown instead.',
    builtin: true,
  },
  {
    id: 'string',
    name: 'STRING page',
    baseUrl: 'https://string-db.org',
    template: '/cgi/network?identifiers={symbol}&species={organismId}',
    display: 'tab',
    requires: ['symbol', 'organismId'],
    builtin: true,
  },
  {
    id: 'uniprot',
    name: 'UniProt',
    baseUrl: 'https://www.uniprot.org',
    template: '/uniprotkb/{swissprot}/entry',
    display: 'embed',
    requires: ['swissprot'],
    builtin: true,
  },
  {
    id: 'uniprot-search',
    name: 'UniProt search',
    baseUrl: 'https://www.uniprot.org',
    template: '/uniprotkb?query={symbol}+AND+organism_id:{organismId}',
    display: 'tab',
    requires: ['symbol'],
    note: 'For proteins with no accession in the loaded release.',
    builtin: true,
  },
  {
    id: 'intact',
    name: 'IntAct',
    baseUrl: 'https://www.ebi.ac.uk',
    template: '/intact/search?query={symbol}',
    display: 'embed',
    requires: ['symbol'],
    builtin: true,
  },
  {
    id: 'amigo',
    name: 'AmiGO (GO terms)',
    baseUrl: 'https://amigo.geneontology.org',
    template: '/amigo/search/bioentity?q={symbol}',
    display: 'tab',
    requires: ['symbol'],
    note: 'Sends X-Frame-Options: DENY, so it cannot be embedded.',
    builtin: true,
  },
  {
    id: 'ncbi-gene',
    name: 'NCBI Gene',
    baseUrl: 'https://www.ncbi.nlm.nih.gov',
    template: '/gene/{entrez}',
    display: 'tab',
    requires: ['entrez'],
    builtin: true,
  },
]

/** Values a template can refer to. */
export interface ResourceContext {
  readonly symbol?: string | null
  readonly biogridId?: number | null
  readonly entrez?: string | null
  readonly systematic?: string | null
  readonly swissprot?: string | null
  readonly organismId?: number | null
  readonly organismName?: string | null
  readonly partnerSymbol?: string | null
}

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g

/** Which placeholders a template refers to. */
export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!)
}

function valueOf(context: ResourceContext, key: string): string | null {
  const raw = (context as Record<string, unknown>)[key]
  if (raw === null || raw === undefined || raw === '') return null
  // BioGRID pipe-joins accessions; a URL wants one.
  const first = String(raw).split('|')[0]!.trim()
  return first === '' ? null : first
}

/**
 * Build a resource's URL, or null when the context cannot satisfy it.
 *
 * Returning null rather than a URL with a hole in it matters: a link to
 * `/uniprotkb//entry` looks like a broken tool, while a missing link correctly says
 * this protein has no accession in the loaded release.
 */
export function resolveUrl(
  resource: ExternalResource,
  context: ResourceContext,
): string | null {
  for (const key of resource.requires) {
    if (valueOf(context, key) === null) return null
  }

  let failed = false
  const path = resource.template.replace(PLACEHOLDER, (_, key: string) => {
    const value = valueOf(context, key)
    if (value === null) {
      failed = true
      return ''
    }
    return encodeURIComponent(value)
  })
  if (failed) return null

  const base = resource.baseUrl.replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}

/** Resources that can be resolved for this protein, in configured order. */
export function availableFor(
  resources: readonly ExternalResource[],
  context: ResourceContext,
): { resource: ExternalResource; url: string }[] {
  const out: { resource: ExternalResource; url: string }[] = []
  for (const resource of resources) {
    const url = resolveUrl(resource, context)
    if (url !== null) out.push({ resource, url })
  }
  return out
}

// --- persistence ------------------------------------------------------------

const STORAGE_KEY = 'prolivis.externalResources'

export class ResourceConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceConfigError'
  }
}

/** Check a user-supplied resource before it is stored. */
export function validateResource(resource: ExternalResource): void {
  if (!resource.id.trim()) throw new ResourceConfigError('A resource needs an id')
  if (!resource.name.trim()) throw new ResourceConfigError('A resource needs a name')

  let url: URL
  try {
    url = new URL(resource.baseUrl)
  } catch {
    throw new ResourceConfigError(
      `"${resource.baseUrl}" is not a valid URL. Include the scheme, e.g. https://…`,
    )
  }
  // Refuse anything that is not a web address: a template is user input that becomes
  // an href, and javascript: or data: there would be an injection vector.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ResourceConfigError('Only http and https addresses are allowed')
  }

  const unknown = placeholdersIn(resource.template).filter(
    (p) =>
      ![
        'symbol',
        'biogridId',
        'entrez',
        'systematic',
        'swissprot',
        'organismId',
        'organismName',
        'partnerSymbol',
      ].includes(p),
  )
  if (unknown.length > 0) {
    throw new ResourceConfigError(
      `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown
        .map((u) => `{${u}}`)
        .join(', ')}`,
    )
  }
}

export function loadResources(): ExternalResource[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return [...DEFAULT_RESOURCES]
    const parsed = JSON.parse(stored) as ExternalResource[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_RESOURCES]
    return parsed
  } catch {
    // A corrupt or unreadable configuration must not cost the user the feature.
    return [...DEFAULT_RESOURCES]
  }
}

export function saveResources(resources: readonly ExternalResource[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(resources))
  } catch {
    // Storage disabled; the configuration lasts for this session only.
  }
}

export function resetResources(): ExternalResource[] {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
  return [...DEFAULT_RESOURCES]
}
