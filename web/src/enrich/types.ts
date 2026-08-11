/**
 * What we learn about a publication from outside BioGRID.
 *
 * BioGRID tells us that a paper reported an interaction and, at most, its first
 * author and year. It says nothing about whether anyone found the paper convincing,
 * or which lab produced it. Both matter for judging evidence: five papers from one
 * group are not five independent replications, and an interaction whose only support
 * is an uncited paper is weaker than one supported by a landmark.
 */
export interface LiteratureRecord {
  /** `pubmed:<id>` or `doi:<id>`, matching the interactions table. */
  readonly publicationKey: string
  /** Source that answered, so a user can tell enriched from merely attempted. */
  readonly provider: 'openalex' | 'pubmed'
  readonly openalexId: string | null
  readonly doi: string | null
  readonly pmid: string | null
  readonly title: string | null
  readonly venue: string | null
  readonly year: number | null
  readonly citationCount: number | null
  readonly isOpenAccess: boolean | null
  /** OpenAlex work type, e.g. `article`, `review`, `preprint`. */
  readonly workType: string | null
  readonly firstAuthor: string | null
  readonly authorCount: number | null
  /**
   * ROR identifiers of the contributing institutions. These are the basis of the
   * trust model's independence term: two publications sharing every institution are
   * one lab reporting twice, not two labs agreeing.
   */
  readonly institutionRors: readonly string[]
  readonly institutionNames: readonly string[]
}

/** A publication we asked about and could not find, cached so we do not re-ask. */
export interface MissingRecord {
  readonly publicationKey: string
  readonly provider: 'openalex' | 'pubmed'
}

export interface EnrichmentProgress {
  readonly fetched: number
  readonly total: number
  readonly message: string
}
