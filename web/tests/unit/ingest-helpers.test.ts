import { describe, expect, it } from 'vitest'
import { labelFromFileName, parseBiogridRelease } from '@/data/ingest'
import { sqlIdent, sqlString, unmappedCanonicalColumns } from '@/model/schema'

describe('parseBiogridRelease', () => {
  it('recovers the release from real BioGRID filenames', () => {
    expect(parseBiogridRelease('BIOGRID-CORONAVIRUS-5.0.260.tab3.txt')).toBe('5.0.260')
    expect(parseBiogridRelease('BIOGRID-ORGANISM-Homo_sapiens-4.4.246.tab3.txt')).toBe(
      '4.4.246',
    )
    expect(parseBiogridRelease('BIOGRID-ALL-5.0.260.tab3.zip')).toBe('5.0.260')
  })

  it('returns null when a file is not named by BioGRID', () => {
    expect(parseBiogridRelease('my-interactions.txt')).toBeNull()
    // LATEST aliases carry no release number; provenance stays honestly unknown.
    expect(parseBiogridRelease('BIOGRID-ALL-LATEST.tab3.zip')).toBeNull()
  })
})

describe('labelFromFileName', () => {
  it('produces a readable label from a BioGRID filename', () => {
    expect(labelFromFileName('BIOGRID-CORONAVIRUS-5.0.260.tab3.txt')).toBe(
      'CORONAVIRUS 5.0.260',
    )
    // The organism is the part that matters when loading one member of the
    // ORGANISM bundle, so it must survive into the label.
    expect(labelFromFileName('BIOGRID-ORGANISM-Homo_sapiens-4.4.246.tab3.txt')).toBe(
      'ORGANISM Homo sapiens 4.4.246',
    )
    expect(labelFromFileName('BIOGRID-ALL-LATEST.tab3.zip')).toBe('ALL LATEST')
  })

  it('falls back to the bare filename for user-supplied files', () => {
    expect(labelFromFileName('/tmp/my study.txt')).toBe('my study')
  })
})

describe('SQL escaping', () => {
  it('escapes quotes so a dataset label cannot break out of a literal', () => {
    expect(sqlString("O'Brien (2001)")).toBe("'O''Brien (2001)'")
    expect(sqlIdent('weird"name')).toBe('"weird""name"')
  })

  it('neutralizes an injection attempt in a filename', () => {
    const hostile = "x'; DROP TABLE interactions; --"
    expect(sqlString(hostile)).toBe("'x''; DROP TABLE interactions; --'")
  })
})

describe('schema coverage', () => {
  it('projects every canonical column into the interactions table', () => {
    expect(unmappedCanonicalColumns()).toEqual([])
  })
})
