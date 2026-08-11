/**
 * Column resolution across BioGRID's tabular formats.
 *
 * BioGRID ships the same data under several column vocabularies, and they disagree:
 * the bulk tab3 dumps write `Experimental System`, `Author`, `Publication Source`,
 * `Throughput` and `Score`, while tab2 writes `Experimental System Name`,
 * `First Author Surname`, `Pubmed ID`, `Interaction Throughput` and
 * `Quantitative Score`. The REST service offers tab2 and extendedTab2 but *not* tab3,
 * so a reader hard-coded to one vocabulary can serve either files or the API, never
 * both.
 *
 * So columns are resolved by alias against a canonical name (we use the tab3 spelling
 * as canonical), case- and punctuation-insensitively. Anything unrecognized resolves
 * to NULL rather than failing the load, which means a future release that renames or
 * appends a column degrades gracefully instead of breaking ingest.
 */

/** Canonical column names — the tab3 spellings, without the leading `#`. */
export const CANONICAL_COLUMNS = [
  'BioGRID Interaction ID',
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
  'Publication Source',
  'Organism ID Interactor A',
  'Organism ID Interactor B',
  'Throughput',
  'Score',
  'Modification',
  'Qualifications',
  'Tags',
  'Source Database',
  'SWISS-PROT Accessions Interactor A',
  'TREMBL Accessions Interactor A',
  'REFSEQ Accessions Interactor A',
  'SWISS-PROT Accessions Interactor B',
  'TREMBL Accessions Interactor B',
  'REFSEQ Accessions Interactor B',
  'Ontology Term IDs',
  'Ontology Term Names',
  'Ontology Term Categories',
  'Ontology Term Qualifier IDs',
  'Ontology Term Qualifier Names',
  'Ontology Term Types',
  'Organism Name Interactor A',
  'Organism Name Interactor B',
] as const

export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number]

/**
 * Additional spellings accepted for a canonical column. The canonical name itself is
 * always accepted and need not be repeated here.
 */
const ALIASES: Partial<Record<CanonicalColumn, readonly string[]>> = {
  'Entrez Gene Interactor A': ['Entrez Gene ID (Interactor A)', 'ENTREZ_GENE_A'],
  'Entrez Gene Interactor B': ['Entrez Gene ID (Interactor B)', 'ENTREZ_GENE_B'],
  'BioGRID ID Interactor A': ['BioGRID ID (Interactor A)', 'BIOGRID_ID_A'],
  'BioGRID ID Interactor B': ['BioGRID ID (Interactor B)', 'BIOGRID_ID_B'],
  'BioGRID Interaction ID': ['BIOGRID_INTERACTION_ID'],
  'Systematic Name Interactor A': [
    'Systematic Name (Interactor A)',
    'SYSTEMATIC_NAME_A',
  ],
  'Systematic Name Interactor B': [
    'Systematic Name (Interactor B)',
    'SYSTEMATIC_NAME_B',
  ],
  'Official Symbol Interactor A': [
    'Official Symbol (Interactor A)',
    'OFFICIAL_SYMBOL_A',
  ],
  'Official Symbol Interactor B': [
    'Official Symbol (Interactor B)',
    'OFFICIAL_SYMBOL_B',
  ],
  'Synonyms Interactor A': ['Synonyms/Aliases (Interactor A)', 'SYNONYMS_A'],
  'Synonyms Interactor B': ['Synonyms/Aliases (Interactor B)', 'SYNONYMS_B'],
  'Experimental System': ['Experimental System Name', 'EXPERIMENTAL_SYSTEM'],
  'Experimental System Type': ['EXPERIMENTAL_SYSTEM_TYPE'],
  Author: ['First Author Surname', 'First Author', 'PUBMED_AUTHOR'],
  // tab2 and the REST service give a bare PubMed id where tab3 gives a prefixed
  // reference such as `PUBMED:9315644` or `DOI:10.1016/...`. Both are accepted; the
  // ingest SQL treats a bare number as a PubMed id.
  'Publication Source': ['Pubmed ID', 'PubMed ID', 'PUBMED_ID'],
  'Organism ID Interactor A': [
    'Organism ID (Interactor A)',
    'Organism Interactor A',
    'ORGANISM_A',
  ],
  'Organism ID Interactor B': [
    'Organism ID (Interactor B)',
    'Organism Interactor B',
    'ORGANISM_B',
  ],
  Throughput: ['Interaction Throughput', 'THROUGHPUT'],
  Score: ['Quantitative Score', 'QUANTITATION'],
  Modification: ['Post Translational Modification', 'MODIFICATION'],
  Qualifications: ['QUALIFICATIONS'],
  Tags: ['TAGS'],
  'Source Database': ['SOURCEDB'],
  'Organism Name Interactor A': ['Organism Name (Interactor A)'],
  'Organism Name Interactor B': ['Organism Name (Interactor B)'],
  // tab2 carries phenotypes where tab3 carries a structured ontology annotation.
  'Ontology Term Names': ['Phenotypes', 'PHENOTYPES'],
}

/**
 * The columns without which the data is not usable: we cannot identify the two
 * interacting genes, or say who reported the interaction and how.
 */
const REQUIRED: readonly CanonicalColumn[] = [
  'BioGRID ID Interactor A',
  'BioGRID ID Interactor B',
  'Official Symbol Interactor A',
  'Official Symbol Interactor B',
  'Experimental System',
  'Publication Source',
]

/** Fold spelling differences: case, underscores, punctuation and spacing. */
function normalize(name: string): string {
  return name
    .replace(/^#/, '')
    .replace(/[_/]/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9 -]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const LOOKUP: ReadonlyMap<string, CanonicalColumn> = (() => {
  const map = new Map<string, CanonicalColumn>()
  for (const canonical of CANONICAL_COLUMNS) {
    map.set(normalize(canonical), canonical)
    for (const alias of ALIASES[canonical] ?? []) {
      map.set(normalize(alias), canonical)
    }
  }
  return map
})()

export class ColumnResolutionError extends Error {
  constructor(
    message: string,
    readonly missing: readonly string[],
  ) {
    super(message)
    this.name = 'ColumnResolutionError'
  }
}

export interface ResolvedHeader {
  /** Canonical column name to its position in the file. */
  readonly index: ReadonlyMap<CanonicalColumn, number>
  /**
   * Header text exactly as written by the producer, by position. SQL generated
   * against the file must quote *this* spelling.
   */
  readonly names: readonly string[]
  /** Canonical columns the producer did not supply; these load as NULL. */
  readonly absent: readonly CanonicalColumn[]
  /** Header fields we could not map to any canonical column. */
  readonly unrecognized: readonly string[]
}

/**
 * Resolve a tab-separated header line into canonical columns.
 *
 * Throws only when a genuinely required column is missing — which is also how a wrong
 * file (tab2 is fine, but MITAB or PSI-25 is not) gets rejected with a useful message.
 */
export function resolveHeader(line: string): ResolvedHeader {
  const cleaned = line.replace(/^\uFEFF/, '').replace(/\r$/, '')
  const names = cleaned.split('\t').map((f) => f.trim())

  const index = new Map<CanonicalColumn, number>()
  const unrecognized: string[] = []

  names.forEach((raw, position) => {
    const canonical = LOOKUP.get(normalize(raw))
    // First spelling wins, so a duplicated column cannot silently shadow the first.
    if (canonical === undefined) unrecognized.push(raw)
    else if (!index.has(canonical)) index.set(canonical, position)
  })

  const missing = REQUIRED.filter((c) => !index.has(c))
  if (missing.length > 0) {
    throw new ColumnResolutionError(
      `This does not look like BioGRID tabular data: required column(s) ` +
        `${missing.map((m) => `"${m}"`).join(', ')} not found. ` +
        `ProLiVis reads the tab3 and tab2 formats — download a *.tab3.zip, ` +
        `not mitab, psi or psi25.`,
      missing,
    )
  }

  return {
    index,
    names,
    absent: CANONICAL_COLUMNS.filter((c) => !index.has(c)),
    unrecognized,
  }
}
