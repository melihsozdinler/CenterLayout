import { describe, expect, it } from 'vitest'
import {
  cell,
  multiValue,
  parseAuthor,
  parsePublicationSource,
  parseScore,
  parseThroughput,
} from '@/data/tab3'

describe('cell', () => {
  it('maps the "-" sentinel and blanks to null, not to a literal dash', () => {
    expect(cell('-')).toBeNull()
    expect(cell('')).toBeNull()
    expect(cell('   ')).toBeNull()
    expect(cell(undefined)).toBeNull()
  })

  it('preserves values that merely contain a dash', () => {
    expect(cell('Cross-Linking-MS (XL-MS)')).toBe('Cross-Linking-MS (XL-MS)')
    expect(cell('Affinity Capture-MS')).toBe('Affinity Capture-MS')
  })
})

describe('multiValue', () => {
  it('splits the pipe-joined synonym cells BioGRID emits', () => {
    expect(multiValue('BOB1|CDC46|L000000279')).toEqual([
      'BOB1',
      'CDC46',
      'L000000279',
    ])
  })

  it('returns an empty list for the null sentinel', () => {
    expect(multiValue('-')).toEqual([])
    expect(multiValue(undefined)).toEqual([])
  })

  it('drops empty and sentinel parts inside a list', () => {
    expect(multiValue('A||-|B')).toEqual(['A', 'B'])
  })
})

describe('parsePublicationSource', () => {
  it('parses PubMed references', () => {
    expect(parsePublicationSource('PUBMED:9315644')).toEqual({
      key: 'pubmed:9315644',
      kind: 'pubmed',
      id: '9315644',
    })
  })

  it('parses DOI references, which are ~20% of a modern release', () => {
    expect(parsePublicationSource('DOI:10.1016/J.CELL.2020.04.026')).toEqual({
      key: 'doi:10.1016/j.cell.2020.04.026',
      kind: 'doi',
      id: '10.1016/j.cell.2020.04.026',
    })
  })

  it('treats a bare number as a PubMed id', () => {
    expect(parsePublicationSource('9315644')?.kind).toBe('pubmed')
  })

  it('keeps unknown prefixes distinguishable rather than guessing', () => {
    const ref = parsePublicationSource('BIORXIV:2020.03.22.002386')
    expect(ref?.kind).toBe('other')
    expect(ref?.key).toBe('other:BIORXIV:2020.03.22.002386')
  })

  it('returns null for the sentinel', () => {
    expect(parsePublicationSource('-')).toBeNull()
    expect(parsePublicationSource('PUBMED:')).toBeNull()
  })
})

describe('parseThroughput', () => {
  it('parses the single-valued cases', () => {
    expect(parseThroughput('Low Throughput')).toEqual({ low: true, high: false })
    expect(parseThroughput('High Throughput')).toEqual({ low: false, high: true })
  })

  it('parses the pipe-joined case, which a scalar field would lose', () => {
    expect(parseThroughput('High Throughput|Low Throughput')).toEqual({
      low: true,
      high: true,
    })
  })

  it('reports neither flag for the sentinel', () => {
    expect(parseThroughput('-')).toEqual({ low: false, high: false })
  })
})

describe('parseAuthor', () => {
  it('splits the "first author (year)" label ProLiVis 1.0 used as a node label', () => {
    expect(parseAuthor('Dalton S (1997)')).toEqual({
      label: 'Dalton S (1997)',
      name: 'Dalton S',
      year: 1997,
    })
  })

  it('handles multi-word surnames', () => {
    expect(parseAuthor('Legesse-Miller A (2006)')?.name).toBe('Legesse-Miller A')
  })

  it('keeps the label when there is no year to extract', () => {
    expect(parseAuthor('Anonymous')).toEqual({
      label: 'Anonymous',
      name: 'Anonymous',
      year: null,
    })
  })

  it('returns null for the sentinel', () => {
    expect(parseAuthor('-')).toBeNull()
  })
})

describe('parseScore', () => {
  it('parses the numeric scores present on a minority of records', () => {
    expect(parseScore('0.963550095')).toBeCloseTo(0.963550095, 9)
    expect(parseScore('-1.5')).toBe(-1.5)
  })

  it('returns null for the sentinel and for non-numeric text', () => {
    expect(parseScore('-')).toBeNull()
    expect(parseScore('not a score')).toBeNull()
  })
})
