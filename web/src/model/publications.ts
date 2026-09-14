/**
 * Searching the literature, and summarising one publication.
 *
 * ProLiVis 1.0 had a completer over its `SOURCE` column and a "Visualize" button that
 * drew the chosen publication's interactions. That is the move the literature view
 * exists to enable — from *who reported this* to *and here is what they reported* —
 * and it is restored here, over the fuller identifiers a modern release carries.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { sqlString } from './schema'

const SEP = String.fromCharCode(0x1f)

export interface PublicationHit {
  readonly publicationKey: string
  /** BioGRID's author-year label, e.g. `Gavin AC (2002)`. */
  readonly label: string
  readonly refKind: string | null
  readonly refId: string | null
  readonly year: number | null
  readonly interactionCount: number
  readonly systemCount: number
  /** Title from enrichment, when the literature has been fetched. */
  readonly title: string | null
}

export interface PublicationSummary extends PublicationHit {
  readonly systems: readonly string[]
  readonly venue: string | null
  readonly citationCount: number | null
  readonly proteinCount: number
}

interface HitRow {
  publication_key: string
  author_label: string | null
  ref_kind: string | null
  ref_id: string | null
  year: number | null
  interaction_count: bigint | number
  system_count: bigint | number
  title: string | null
}

const num = (v: bigint | number | null | undefined) => Number(v ?? 0)

/**
 * Find publications by author, year, PubMed id, DOI or enriched title.
 *
 * Ordered by how much each contributed, not by how well it matched: a search for
 * "Gavin" should surface the 2002 proteome screen before a one-interaction paper by
 * the same author.
 */
export async function findPublications(
  engine: DuckDBEngine,
  datasetId: string,
  query: string,
  limit = 25,
): Promise<PublicationHit[]> {
  const term = query.trim()
  if (term === '') return []
  const like = sqlString(`%${term.toUpperCase()}%`)

  const rows = await engine.rows<HitRow>(`
    SELECT
      p.publication_key,
      p.author_label,
      p.ref_kind,
      p.ref_id,
      p.year,
      p.pair_count   AS interaction_count,
      p.system_count,
      l.title
    FROM publications p
    LEFT JOIN literature l ON l.publication_key = p.publication_key
    WHERE p.dataset_id = ${sqlString(datasetId)}
      AND (
        upper(coalesce(p.author_label, '')) LIKE ${like}
        OR upper(coalesce(p.ref_id, ''))    LIKE ${like}
        OR upper(coalesce(l.title, ''))     LIKE ${like}
      )
    ORDER BY p.pair_count DESC, p.publication_key
    LIMIT ${Math.floor(limit)}`)

  return rows.map(toHit)
}

/** The publications contributing most to a dataset, for an empty search box. */
export async function topPublications(
  engine: DuckDBEngine,
  datasetId: string,
  limit = 15,
  organismId?: number,
): Promise<PublicationHit[]> {
  // Restricting by organism needs the interaction rows, since a publication itself is
  // not organism-specific — a host-pathogen paper belongs to both.
  const organismJoin =
    organismId === undefined
      ? ''
      : `AND EXISTS (
           SELECT 1 FROM interactions i
           WHERE i.dataset_id = p.dataset_id
             AND i.publication_key = p.publication_key
             AND (i.organism_id_a = ${organismId} OR i.organism_id_b = ${organismId}))`

  const rows = await engine.rows<HitRow>(`
    SELECT
      p.publication_key, p.author_label, p.ref_kind, p.ref_id, p.year,
      p.pair_count AS interaction_count, p.system_count, l.title
    FROM publications p
    LEFT JOIN literature l ON l.publication_key = p.publication_key
    WHERE p.dataset_id = ${sqlString(datasetId)} ${organismJoin}
    ORDER BY p.pair_count DESC, p.publication_key
    LIMIT ${Math.floor(limit)}`)

  return rows.map(toHit)
}

function toHit(row: HitRow): PublicationHit {
  return {
    publicationKey: row.publication_key,
    // Fall back to the key: a publication with no author label is still a real
    // publication, and hiding it would understate the literature.
    label: row.author_label ?? row.publication_key,
    refKind: row.ref_kind,
    refId: row.ref_id,
    year: row.year === null ? null : Number(row.year),
    interactionCount: num(row.interaction_count),
    systemCount: num(row.system_count),
    title: row.title,
  }
}

/** Everything about one publication, for the panel above its interaction graph. */
export async function publicationSummary(
  engine: DuckDBEngine,
  datasetId: string,
  publicationKey: string,
): Promise<PublicationSummary | null> {
  const id = sqlString(datasetId)
  const key = sqlString(publicationKey)

  const row = await engine.row<
    HitRow & {
      systems: string | null
      venue: string | null
      citation_count: bigint | number | null
      protein_count: bigint | number
    }
  >(`
    SELECT
      p.publication_key, p.author_label, p.ref_kind, p.ref_id, p.year,
      p.pair_count AS interaction_count, p.system_count,
      l.title, l.venue, l.citation_count,
      (SELECT string_agg(DISTINCT i.experimental_system, ${sqlString(SEP)})
         FROM interactions i
        WHERE i.dataset_id = ${id} AND i.publication_key = ${key})  AS systems,
      (SELECT count(DISTINCT g) FROM (
         SELECT biogrid_id_a AS g FROM interactions
          WHERE dataset_id = ${id} AND publication_key = ${key}
         UNION ALL
         SELECT biogrid_id_b FROM interactions
          WHERE dataset_id = ${id} AND publication_key = ${key}))    AS protein_count
    FROM publications p
    LEFT JOIN literature l ON l.publication_key = p.publication_key
    WHERE p.dataset_id = ${id} AND p.publication_key = ${key}`)

  if (!row) return null
  return {
    ...toHit(row),
    systems: row.systems ? row.systems.split(SEP).filter(Boolean) : [],
    venue: row.venue,
    citationCount:
      row.citation_count === null || row.citation_count === undefined
        ? null
        : Number(row.citation_count),
    proteinCount: num(row.protein_count),
  }
}

/** External URL for a publication reference, when one can be built. */
export function publicationUrl(
  refKind: string | null,
  refId: string | null,
): string | null {
  if (!refId) return null
  if (refKind === 'pubmed') return `https://pubmed.ncbi.nlm.nih.gov/${refId}/`
  if (refKind === 'doi') return `https://doi.org/${refId}`
  return null
}
