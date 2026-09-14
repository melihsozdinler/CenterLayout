import { describe, expect, it } from 'vitest'
import { ColumnResolutionError, resolveHeader } from '@/data/columns'
import { TAB3_COLUMNS } from '@/data/tab3'

/** The real header line from BIOGRID-CORONAVIRUS-5.0.260.tab3.txt. */
const TAB3_HEADER = TAB3_COLUMNS.join('\t')

/**
 * tab2 exactly as the live REST service returns it (verified against
 * webservice.thebiogrid.org, release 5.0.259). Closer to tab3 than the wiki's
 * documentation suggests, but it still differs: `Pubmed ID`, `Organism Interactor A/B`
 * and `Phenotypes`, and none of the tab3-only accession/ontology/organism-name columns.
 */
const TAB2_HEADER = [
  '#BioGRID Interaction ID',
  'Entrez Gene Interactor A',
  'Entrez Gene Interactor B',
  'BioGRID ID Interactor A',
  'BioGRID ID Interactor B',
  'Systematic Name Interactor A',
  'Systematic Name Interactor B',
  'Official Symbol Interactor A',
  'Official Symbol Interactor B',
  'Synonyms Interactor A',
  'Synonyms Interactor B',
  'Experimental System',
  'Experimental System Type',
  'Author',
  'Pubmed ID',
  'Organism Interactor A',
  'Organism Interactor B',
  'Throughput',
  'Score',
  'Modification',
  'Phenotypes',
  'Qualifications',
  'Tags',
  'Source Database',
].join('\t')

describe('resolveHeader on tab3', () => {
  it('resolves every canonical column from a real tab3 header', () => {
    const header = resolveHeader(TAB3_HEADER)
    expect(header.absent).toEqual([])
    expect(header.unrecognized).toEqual([])
    expect(header.index.get('BioGRID Interaction ID')).toBe(0)
    expect(header.index.get('Experimental System')).toBe(11)
    expect(header.index.get('Organism Name Interactor B')).toBe(36)
  })

  it('keeps the literal spelling, including the leading #', () => {
    const header = resolveHeader(TAB3_HEADER)
    // SQL generated against the file must quote the spelling the file actually uses.
    expect(header.names[0]).toBe('#BioGRID Interaction ID')
  })

  it('accepts a header without the leading #', () => {
    const header = resolveHeader(TAB3_HEADER.replace(/^#/, ''))
    expect(header.index.get('BioGRID Interaction ID')).toBe(0)
    expect(header.names[0]).toBe('BioGRID Interaction ID')
  })

  it('tolerates a UTF-8 BOM and CRLF line endings', () => {
    const header = resolveHeader(`\uFEFF${TAB3_HEADER}\r`)
    expect(header.index.get('Organism Name Interactor B')).toBe(36)
    expect(header.absent).toEqual([])
  })
})

/** The spellings the BioGRID wiki documents for tab2, which the service does not use. */
const TAB2_DOCUMENTED_HEADER = TAB2_HEADER.split('\t')
  .map((c) =>
    (
      ({
        'Experimental System': 'Experimental System Name',
        Author: 'First Author Surname',
        'Organism Interactor A': 'Organism ID (Interactor A)',
        'Organism Interactor B': 'Organism ID (Interactor B)',
        Throughput: 'Interaction Throughput',
        Score: 'Quantitative Score',
        Modification: 'Post Translational Modification',
      }) as Record<string, string>
    )[c] ?? c,
  )
  .join('\t')

describe('resolveHeader on tab2', () => {
  it('maps the live REST spellings onto the same canonical columns', () => {
    const header = resolveHeader(TAB2_HEADER)

    // `Pubmed ID` and `Organism Interactor A` differ from tab3 and would be lost by a
    // tab3-only reader — and tab2 is the only tabular format the REST service offers.
    expect(header.index.get('Publication Source')).toBe(14)
    expect(header.index.get('Organism ID Interactor A')).toBe(15)
    expect(header.index.get('Experimental System')).toBe(11)
    expect(header.index.get('Author')).toBe(13)
    expect(header.index.get('Throughput')).toBe(17)
    expect(header.index.get('Score')).toBe(18)
    expect(header.index.get('Modification')).toBe(19)
  })

  it('also accepts the spellings the wiki documents, in case the service changes', () => {
    const header = resolveHeader(TAB2_DOCUMENTED_HEADER)
    expect(header.index.get('Experimental System')).toBe(11)
    expect(header.index.get('Author')).toBe(13)
    expect(header.index.get('Organism ID Interactor A')).toBe(15)
    expect(header.index.get('Throughput')).toBe(17)
    expect(header.index.get('Score')).toBe(18)
    expect(header.index.get('Modification')).toBe(19)
  })

  it('reports the tab3-only columns as absent rather than failing', () => {
    const header = resolveHeader(TAB2_HEADER)
    expect(header.unrecognized).toEqual([])
    expect(header.absent).toContain('SWISS-PROT Accessions Interactor A')
    expect(header.absent).toContain('Organism Name Interactor A')
    expect(header.absent).toContain('Ontology Term IDs')
    // Phenotypes is tab2's analogue of the ontology term names, so it maps across.
    expect(header.absent).not.toContain('Ontology Term Names')
  })
})

describe('resolveHeader failure modes', () => {
  it('rejects a file missing the columns that identify the interactors', () => {
    const psiLike = 'ID(s) interactor A\tID(s) interactor B\tAlt. ID(s) interactor A'
    expect(() => resolveHeader(psiLike)).toThrow(ColumnResolutionError)
    expect(() => resolveHeader(psiLike)).toThrow(/tab3/)
  })

  it('names the missing columns so the user can tell what went wrong', () => {
    try {
      resolveHeader('Official Symbol Interactor A\tOfficial Symbol Interactor B')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ColumnResolutionError)
      expect((e as ColumnResolutionError).missing).toContain('Experimental System')
      expect((e as ColumnResolutionError).missing).toContain('Publication Source')
    }
  })

  it('surfaces columns added by a future release instead of dropping them silently', () => {
    const header = resolveHeader(`${TAB3_HEADER}\tSome New Column`)
    expect(header.unrecognized).toEqual(['Some New Column'])
    expect(header.absent).toEqual([])
  })

  it('does not let a duplicated column shadow the first occurrence', () => {
    const header = resolveHeader(`${TAB3_HEADER}\tExperimental System`)
    expect(header.index.get('Experimental System')).toBe(11)
  })
})
