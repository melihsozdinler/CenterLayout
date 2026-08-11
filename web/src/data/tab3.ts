/**
 * BioGRID TAB 3.0 format.
 *
 * Everything here is derived from a real dump (BIOGRID-CORONAVIRUS-5.0.260.tab3.txt),
 * not from the wiki summary, which differs in several column names. Notable realities
 * the rest of the codebase depends on:
 *
 *   - The first column header is prefixed with `#`.
 *   - The null sentinel is a bare `-`, never an empty string.
 *   - `Publication Source` is prefixed and is *not* always a PubMed id: roughly a fifth
 *     of rows in a modern release carry `DOI:...` instead of `PUBMED:...`.
 *   - `Throughput` is a pipe-joined set, e.g. `High Throughput|Low Throughput`.
 *   - Multi-valued columns (synonyms, accessions, ontology terms) are pipe-joined.
 *   - Files are plain tab-separated with no CSV quoting.
 */

import { resolveHeader, type ResolvedHeader } from './columns'

/** Column headers in file order. Index in this array is the column's position. */
export const TAB3_COLUMNS = [
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

export type Tab3ColumnName = (typeof TAB3_COLUMNS)[number]

/** The snake_case SQL column each tab3 header maps to, in file order. */
export const TAB3_SQL_COLUMNS: readonly string[] = [
  'biogrid_interaction_id',
  'entrez_a',
  'entrez_b',
  'biogrid_id_a',
  'biogrid_id_b',
  'systematic_a',
  'systematic_b',
  'symbol_a',
  'symbol_b',
  'synonyms_a',
  'synonyms_b',
  'experimental_system',
  'experimental_system_type',
  'author',
  'publication_source',
  'organism_id_a',
  'organism_id_b',
  'throughput',
  'score',
  'modification',
  'qualifications',
  'tags',
  'source_database',
  'swissprot_a',
  'trembl_a',
  'refseq_a',
  'swissprot_b',
  'trembl_b',
  'refseq_b',
  'ontology_term_ids',
  'ontology_term_names',
  'ontology_term_categories',
  'ontology_term_qualifier_ids',
  'ontology_term_qualifier_names',
  'ontology_term_types',
  'organism_name_a',
  'organism_name_b',
]

/** The sentinel BioGRID writes for "no value". */
export const NULL_SENTINEL = '-'

/** Separator inside multi-valued cells (synonyms, accessions, throughput, ontology). */
export const MULTI_VALUE_SEPARATOR = '|'

export class Tab3FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Tab3FormatError'
  }
}

/**
 * Header parsing is delegated to `columns.ts`, which resolves BioGRID's several
 * tabular vocabularies (tab3 files, tab2 from the REST service) onto one canonical
 * set of column names.
 */
export type Tab3Header = ResolvedHeader

/**
 * Validate a BioGRID tabular header line and return the columns actually present.
 *
 * Retained as a named export because "does this file look like BioGRID tab3?" is a
 * meaningful question at the ingest boundary; the resolution itself is alias-based
 * and accepts tab2 as well.
 */
export function parseTab3Header(line: string): Tab3Header {
  return resolveHeader(line)
}

/** `-` becomes null; everything else is returned verbatim. */
export function cell(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' || trimmed === NULL_SENTINEL ? null : trimmed
}

/** Split a pipe-joined cell, dropping the null sentinel and empty parts. */
export function multiValue(value: string | undefined): string[] {
  const v = cell(value)
  if (v === null) return []
  return v
    .split(MULTI_VALUE_SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== NULL_SENTINEL)
}

// --- Publication source -----------------------------------------------------

export type PublicationRefKind = 'pubmed' | 'doi' | 'other'

export interface PublicationRef {
  /** Stable key used as the primary key of the publications table. */
  readonly key: string
  readonly kind: PublicationRefKind
  /** Bare identifier without the `PUBMED:` / `DOI:` prefix. */
  readonly id: string
}

/**
 * Parse a `Publication Source` cell.
 *
 * ProLiVis 1.0 assumed this was always a PubMed id; it is not. Preserving the kind
 * matters downstream because DOIs resolve against OpenAlex directly while PMIDs need
 * a lookup, and because a DOI-only record cannot be enriched via PubMed eutils.
 */
export function parsePublicationSource(value: string | undefined): PublicationRef | null {
  const raw = cell(value)
  if (raw === null) return null

  const colon = raw.indexOf(':')
  if (colon === -1) {
    // Bare numeric values in the wild are PubMed ids.
    return /^\d+$/.test(raw)
      ? { key: `pubmed:${raw}`, kind: 'pubmed', id: raw }
      : { key: `other:${raw}`, kind: 'other', id: raw }
  }

  const prefix = raw.slice(0, colon).trim().toUpperCase()
  const id = raw.slice(colon + 1).trim()
  if (id === '') return null

  if (prefix === 'PUBMED') return { key: `pubmed:${id}`, kind: 'pubmed', id }
  // DOIs are case-insensitive and conventionally lowercased.
  if (prefix === 'DOI') {
    const doi = id.toLowerCase()
    return { key: `doi:${doi}`, kind: 'doi', id: doi }
  }
  return { key: `other:${raw}`, kind: 'other', id: raw }
}

// --- Throughput -------------------------------------------------------------

export interface ThroughputFlags {
  readonly low: boolean
  readonly high: boolean
}

/**
 * `Throughput` holds a set, not a scalar: a record may be tagged
 * `High Throughput|Low Throughput` when a publication reports the interaction both in
 * a screen and in a targeted follow-up.
 */
export function parseThroughput(value: string | undefined): ThroughputFlags {
  const parts = multiValue(value).map((s) => s.toLowerCase())
  return {
    low: parts.some((p) => p.startsWith('low')),
    high: parts.some((p) => p.startsWith('high')),
  }
}

// --- Author -----------------------------------------------------------------

export interface AuthorRef {
  /** Full cell as BioGRID wrote it, e.g. `Dalton S (1997)`. */
  readonly label: string
  /** Surname + initials, e.g. `Dalton S`. Used as a cheap lab-identity proxy. */
  readonly name: string
  readonly year: number | null
}

/**
 * Split BioGRID's `Author` cell, which is the "first author + year" label that
 * ProLiVis 1.0 used as its publication node label (its `SOURCE` column).
 */
export function parseAuthor(value: string | undefined): AuthorRef | null {
  const raw = cell(value)
  if (raw === null) return null

  const match = /^(.*?)\s*\((\d{4})\)\s*$/.exec(raw)
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return { label: raw, name: match[1].trim(), year: Number(match[2]) }
  }
  return { label: raw, name: raw, year: null }
}

// --- Score ------------------------------------------------------------------

/** `Score` is free-form in BioGRID; only finite numerics are meaningful. */
export function parseScore(value: string | undefined): number | null {
  const raw = cell(value)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
