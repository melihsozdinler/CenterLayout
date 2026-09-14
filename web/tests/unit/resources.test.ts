import { describe, expect, it } from 'vitest'
import {
  availableFor,
  DEFAULT_RESOURCES,
  placeholdersIn,
  ResourceConfigError,
  resolveUrl,
  validateResource,
  type ExternalResource,
} from '@/external/resources'

const tp53 = {
  symbol: 'TP53',
  biogridId: 112315,
  entrez: '7157',
  swissprot: 'P04637',
  organismId: 9606,
  organismName: 'Homo sapiens',
  systematic: null,
}

const byId = (id: string) => DEFAULT_RESOURCES.find((r) => r.id === id)!

describe('resolveUrl', () => {
  it('substitutes placeholders into the template', () => {
    expect(resolveUrl(byId('biogrid'), tp53)).toBe('https://thebiogrid.org/112315')
    expect(resolveUrl(byId('uniprot'), tp53)).toBe(
      'https://www.uniprot.org/uniprotkb/P04637/entry',
    )
    expect(resolveUrl(byId('ncbi-gene'), tp53)).toBe(
      'https://www.ncbi.nlm.nih.gov/gene/7157',
    )
  })

  it('returns null rather than a URL with a hole in it', () => {
    // A link to /uniprotkb//entry looks like a broken tool; no link correctly says
    // this protein has no accession in the loaded release.
    expect(resolveUrl(byId('uniprot'), { ...tp53, swissprot: null })).toBeNull()
    expect(resolveUrl(byId('ncbi-gene'), { ...tp53, entrez: '' })).toBeNull()
  })

  it('takes the first of BioGRID pipe-joined accessions', () => {
    const url = resolveUrl(byId('uniprot'), { ...tp53, swissprot: 'P04637|Q9NPJ3' })
    expect(url).toBe('https://www.uniprot.org/uniprotkb/P04637/entry')
  })

  it('percent-encodes values so a symbol cannot break the URL', () => {
    const url = resolveUrl(byId('intact'), { ...tp53, symbol: 'A&B C' })
    expect(url).toContain('A%26B%20C')
    expect(url).not.toContain('A&B C')
  })

  it('tolerates a base URL with or without a trailing slash', () => {
    const withSlash: ExternalResource = { ...byId('biogrid'), baseUrl: 'https://x.org/' }
    expect(resolveUrl(withSlash, tp53)).toBe('https://x.org/112315')
  })
})

describe('availableFor', () => {
  it('offers only what the protein can satisfy', () => {
    const full = availableFor(DEFAULT_RESOURCES, tp53).map((r) => r.resource.id)
    expect(full).toContain('biogrid')
    expect(full).toContain('uniprot')

    const sparse = availableFor(DEFAULT_RESOURCES, {
      symbol: 'orf9b',
      biogridId: 4383848,
      organismId: 2697049,
    }).map((r) => r.resource.id)
    // A viral protein with no UniProt accession still gets BioGRID and the searches.
    expect(sparse).toContain('biogrid')
    expect(sparse).not.toContain('uniprot')
    expect(sparse).toContain('uniprot-search')
  })
})

describe('the shipped defaults', () => {
  it('declare embedding only where the site permits it', () => {
    // Verified against the live sites: AmiGO sends X-Frame-Options DENY and STRING's
    // pages sit behind a Cloudflare challenge, so neither may claim 'embed'.
    expect(byId('amigo').display).toBe('tab')
    expect(byId('string').display).toBe('tab')
    expect(byId('biogrid').display).toBe('embed')
    // STRING is still reachable, as the image its API returns.
    expect(byId('string-image').display).toBe('image')
  })

  it('use https throughout', () => {
    for (const resource of DEFAULT_RESOURCES) {
      expect(resource.baseUrl.startsWith('https://')).toBe(true)
    }
  })

  it('declare every placeholder their template uses as required', () => {
    for (const resource of DEFAULT_RESOURCES) {
      for (const placeholder of placeholdersIn(resource.template)) {
        // organismId may be absent from `requires` where a search still works
        // without it; everything else must be declared.
        if (placeholder === 'organismId') continue
        expect(resource.requires).toContain(placeholder)
      }
    }
  })
})

describe('validateResource', () => {
  const base: ExternalResource = {
    id: 'x',
    name: 'X',
    baseUrl: 'https://example.org',
    template: '/{symbol}',
    display: 'tab',
    requires: [],
  }

  it('accepts a well-formed resource', () => {
    expect(() => validateResource(base)).not.toThrow()
  })

  it('refuses a non-web scheme, which would be an injection vector', () => {
    // A template becomes an href; javascript: there would execute in our origin.
    expect(() =>
      validateResource({ ...base, baseUrl: 'javascript:alert(1)' }),
    ).toThrow(ResourceConfigError)
    expect(() => validateResource({ ...base, baseUrl: 'data:text/html,x' })).toThrow()
  })

  it('refuses an unparseable URL with an actionable message', () => {
    expect(() => validateResource({ ...base, baseUrl: 'example.org' })).toThrow(
      /Include the scheme/,
    )
  })

  it('names an unknown placeholder rather than silently emitting it', () => {
    expect(() => validateResource({ ...base, template: '/{gene}' })).toThrow(/\{gene\}/)
  })

  it('requires a name and an id', () => {
    expect(() => validateResource({ ...base, name: ' ' })).toThrow(/name/)
    expect(() => validateResource({ ...base, id: '' })).toThrow(/id/)
  })
})
