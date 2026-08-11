import { describe, expect, it } from 'vitest'
import {
  highLevelToRows,
  pairsToRows,
  toDelimited,
  toGml,
  toGraphml,
  toSif,
} from '@/export/formats'
import {
  buildManifest,
  checkReproducibility,
  MANIFEST_KIND,
  ManifestError,
  parseManifest,
  serializeManifest,
} from '@/export/manifest'
import { DEFAULT_CONSTANTS, PRESETS } from '@/trust/model'
import type { ScoredPair } from '@/trust/score'
import type { DatasetSummary } from '@/model/datasets'

function pair(overrides: Partial<ScoredPair> = {}): ScoredPair {
  return {
    pairKey: '1~2',
    score: 0.734567891,
    coverage: 1,
    evidenceType: 'physical',
    terms: {
      replication: 0.5,
      independence: null,
      methodDiversity: 0.25,
      methodWeight: 1,
      throughput: 0.75,
      literatureImpact: null,
      currency: 0.9,
    },
    nodeLo: 108276,
    nodeHi: 112315,
    symbolLo: 'MDM2',
    symbolHi: 'TP53',
    ...overrides,
  }
}

describe('toDelimited', () => {
  it('writes a header and rows', () => {
    const csv = toDelimited([{ a: 1, b: 'x' }, { a: 2, b: 'y' }])
    expect(csv).toBe('a,b\n1,x\n2,y\n')
  })

  it('quotes values containing the delimiter, quotes or newlines', () => {
    const csv = toDelimited([{ note: 'a,b' }, { note: 'say "hi"' }, { note: 'two\nlines' }])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"say ""hi"""')
    expect(csv).toContain('"two\nlines"')
  })

  it('does not quote unnecessarily in TSV, but does quote embedded tabs', () => {
    expect(toDelimited([{ note: 'a,b' }], 'tsv')).toContain('a,b\n')
    expect(toDelimited([{ note: 'a\tb' }], 'tsv')).toContain('"a\tb"')
  })

  it('keeps columns aligned when rows have different keys', () => {
    const csv = toDelimited([{ a: 1 }, { b: 2 }])
    expect(csv).toBe('a,b\n1,\n,2\n')
  })

  it('returns nothing for no rows', () => {
    expect(toDelimited([])).toBe('')
  })
})

describe('pairsToRows', () => {
  it('expands every trust term into its own column', () => {
    const rows = pairsToRows([pair()])
    expect(rows[0]).toMatchObject({
      gene_a: 'MDM2',
      gene_b: 'TP53',
      biogrid_id_a: 108276,
      evidence_type: 'physical',
      term_replication: 0.5,
      term_method_diversity: 0.25,
    })
  })

  it('writes an unknown term as empty rather than as zero', () => {
    const rows = pairsToRows([pair()])
    // An unresolved publication is not a publication with no impact.
    expect(rows[0]!['term_independence']).toBe('')
    expect(rows[0]!['term_literature_impact']).toBe('')
  })

  it('carries coverage, so a partial score can be recognised as one', () => {
    const rows = pairsToRows([pair({ coverage: 0.42 })])
    expect(rows[0]!['trust_coverage']).toBe(0.42)
  })

  it('rounds scores to a sane precision', () => {
    expect(pairsToRows([pair()])[0]!['trust_score']).toBe(0.734568)
  })
})

describe('toSif', () => {
  it('writes Cytoscape triples with trust in the interaction type', () => {
    const sif = toSif([pair({ score: 0.9 }), pair({ score: 0.1 })])
    const lines = sif.trim().split('\n')
    expect(lines[0]).toBe('MDM2\ttrust5of5\tTP53')
    expect(lines[1]).toBe('MDM2\ttrust1of5\tTP53')
  })

  it('falls back to gene ids when a symbol is missing', () => {
    expect(toSif([pair({ symbolLo: null })])).toContain('108276\t')
  })
})

describe('toGraphml', () => {
  it('declares typed keys and emits one node per gene', () => {
    const xml = toGraphml([pair()])
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('attr.name="trust_score" attr.type="double"')
    expect((xml.match(/<node /g) ?? []).length).toBe(2)
    expect((xml.match(/<edge /g) ?? []).length).toBe(1)
  })

  it('omits unknown terms rather than writing them as zero', () => {
    const xml = toGraphml([pair()])
    expect(xml).toContain('key="t_replication"')
    expect(xml).not.toContain('key="t_independence"')
  })

  it('escapes gene labels so a stray character cannot break the file', () => {
    const xml = toGraphml([pair({ symbolLo: 'A&B<C>' })])
    expect(xml).toContain('A&amp;B&lt;C&gt;')
  })

  it('does not repeat a gene that appears in several interactions', () => {
    const xml = toGraphml([pair(), pair({ pairKey: '1~3', nodeHi: 999, symbolHi: 'RPL5' })])
    expect((xml.match(/<node /g) ?? []).length).toBe(3)
  })
})

describe('toGml', () => {
  it('writes a GML graph OGDF and Gephi can read', () => {
    const gml = toGml([pair()])
    expect(gml.startsWith('graph [')).toBe(true)
    expect(gml).toContain('directed 0')
    expect(gml).toContain('label "MDM2"')
    expect(gml).toContain('source 108276')
    expect(gml.trimEnd().endsWith(']')).toBe(true)
  })

  it('strips characters that would unbalance a GML string', () => {
    expect(toGml([pair({ symbolLo: 'we"ird\\' })])).toContain('label "weird"')
  })
})

describe('highLevelToRows', () => {
  it('produces module and link tables', () => {
    const { nodes, edges } = highLevelToRows({
      strategy: 'cliques',
      nodes: [
        {
          id: 'g0',
          label: 'Clique 1: A, B, C',
          members: [1, 2, 3],
          memberLabels: ['A', 'B', 'C'],
          size: 3,
          internalEdges: 3,
          internalTrust: 0.8,
        },
      ],
      edges: [{ source: 'g0', target: 'g1', edgeCount: 2, trustMass: 0.35 }],
      ungrouped: [],
      truncated: false,
    })

    expect(nodes[0]).toMatchObject({ group_id: 'g0', size: 3, members: 'A|B|C' })
    expect(edges[0]).toMatchObject({ edge_count: 2, trust_mass: 0.35 })
  })
})

const dataset: DatasetSummary = {
  datasetId: 'ds1',
  label: 'CORONAVIRUS 5.0.260',
  sourceKind: 'file',
  sourceDetail: 'BIOGRID-CORONAVIRUS-5.0.260.tab3.zip',
  biogridRelease: '5.0.260',
  loadedAt: new Date('2026-08-11T12:00:00Z'),
  recordCount: 975,
  geneCount: 500,
  publicationCount: 164,
  pairCount: 898,
  organismCount: 12,
  notes: null,
}

describe('buildManifest', () => {
  it('records everything needed to reproduce a figure', () => {
    const manifest = buildManifest({
      dataset,
      query: { datasetId: 'ds1', organismId: 2697049 },
      trust: PRESETS['literature-aware']!,
      layout: { aggregateBelow: 5 },
      organismId: 2697049,
      note: 'Figure 2',
      createdAt: '2026-08-11T13:00:00Z',
    })

    expect(manifest.kind).toBe(MANIFEST_KIND)
    expect(manifest.dataset.biogridRelease).toBe('5.0.260')
    expect(manifest.dataset.recordCount).toBe(975)
    expect(manifest.trust!.preset).toBe('literature-aware')
    expect(manifest.layout).toEqual({ aggregateBelow: 5 })
    expect(manifest.note).toBe('Figure 2')
  })

  it('is a pure function of its inputs, so it can be diffed and tested', () => {
    const input = { dataset, createdAt: '2026-01-01T00:00:00Z' }
    expect(serializeManifest(buildManifest(input))).toBe(
      serializeManifest(buildManifest(input)),
    )
  })

  it('round-trips through serialization', () => {
    const manifest = buildManifest({ dataset, trust: PRESETS['evidence-only']! })
    const { manifest: parsed, warnings } = parseManifest(serializeManifest(manifest))
    expect(parsed.dataset.label).toBe('CORONAVIRUS 5.0.260')
    expect(parsed.trust!.constants['replicationScale']).toBe(
      DEFAULT_CONSTANTS.replicationScale,
    )
    expect(warnings).toEqual([])
  })
})

describe('parseManifest', () => {
  it('rejects something that is not a manifest', () => {
    expect(() => parseManifest('{"kind":"something-else"}')).toThrow(ManifestError)
    expect(() => parseManifest('not json')).toThrow(/valid JSON/)
    expect(() => parseManifest(`{"kind":"${MANIFEST_KIND}"}`)).toThrow(/provenance/)
  })

  it('accepts a newer format with a warning rather than stranding the user', () => {
    const manifest = buildManifest({ dataset })
    const future = JSON.parse(serializeManifest(manifest))
    future.manifestVersion = 99
    future.somethingNew = true

    const { warnings } = parseManifest(JSON.stringify(future))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/newer version/)
  })
})

describe('checkReproducibility', () => {
  const manifest = buildManifest({ dataset })

  it('matches a loaded dataset by release', () => {
    const { match, problems } = checkReproducibility(manifest, [dataset])
    expect(match?.datasetId).toBe('ds1')
    expect(problems).toEqual([])
  })

  it('says what to load when nothing matches', () => {
    const { match, problems } = checkReproducibility(manifest, [])
    expect(match).toBeNull()
    expect(problems[0]).toMatch(/Load it to reproduce/)
  })

  it('reports a release mismatch without refusing, since that is often the point', () => {
    const newer: DatasetSummary = {
      ...dataset,
      label: 'CORONAVIRUS 5.0.260',
      biogridRelease: '5.1.0',
      recordCount: 1200,
    }
    const { match, problems } = checkReproducibility(manifest, [newer])
    expect(match).not.toBeNull()
    expect(problems.some((p) => p.includes('Release differs'))).toBe(true)
    expect(problems.some((p) => p.includes('Record count differs'))).toBe(true)
  })
})
