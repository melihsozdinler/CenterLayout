/**
 * Dataset registry: what is loaded, where it came from, and how big it is.
 *
 * Provenance is not decoration. Comparing two datasets is only meaningful if we can
 * say which BioGRID release and which query each came from, and the session manifest
 * that reproduces a figure is built from exactly these records.
 */

import type { DuckDBEngine } from '../data/duckdb'
import { sqlString } from './schema'

export type DatasetSourceKind = 'file' | 'rest'

export interface DatasetSummary {
  readonly datasetId: string
  readonly label: string
  readonly sourceKind: DatasetSourceKind
  readonly sourceDetail: string | null
  readonly biogridRelease: string | null
  readonly loadedAt: Date
  readonly recordCount: number
  readonly geneCount: number
  readonly publicationCount: number
  readonly pairCount: number
  readonly organismCount: number
  readonly notes: string | null
}

interface DatasetRow {
  dataset_id: string
  label: string
  source_kind: string
  source_detail: string | null
  biogrid_release: string | null
  loaded_at: Date | number | bigint
  record_count: bigint | number
  gene_count: bigint | number
  publication_count: bigint | number
  pair_count: bigint | number
  organism_count: bigint | number
  notes: string | null
}

const num = (v: bigint | number | null | undefined): number => Number(v ?? 0)

function toDate(v: Date | number | bigint): Date {
  if (v instanceof Date) return v
  // DuckDB timestamps arrive as microseconds since epoch when not cast to Date.
  return new Date(Number(v) / 1000)
}

export async function listDatasets(engine: DuckDBEngine): Promise<DatasetSummary[]> {
  const rows = await engine.rows<DatasetRow>(`
    SELECT
      d.dataset_id, d.label, d.source_kind, d.source_detail, d.biogrid_release,
      d.loaded_at, d.record_count, d.notes,
      (SELECT count(*) FROM genes g WHERE g.dataset_id = d.dataset_id)         AS gene_count,
      (SELECT count(*) FROM publications p WHERE p.dataset_id = d.dataset_id)  AS publication_count,
      (SELECT count(DISTINCT i.pair_key) FROM interactions i
        WHERE i.dataset_id = d.dataset_id)                                     AS pair_count,
      (SELECT count(DISTINCT g.organism_id) FROM genes g
        WHERE g.dataset_id = d.dataset_id)                                     AS organism_count
    FROM datasets d
    ORDER BY d.loaded_at`)

  return rows.map((r) => ({
    datasetId: r.dataset_id,
    label: r.label,
    sourceKind: (r.source_kind === 'rest' ? 'rest' : 'file') as DatasetSourceKind,
    sourceDetail: r.source_detail,
    biogridRelease: r.biogrid_release,
    loadedAt: toDate(r.loaded_at),
    recordCount: num(r.record_count),
    geneCount: num(r.gene_count),
    publicationCount: num(r.publication_count),
    pairCount: num(r.pair_count),
    organismCount: num(r.organism_count),
    notes: r.notes,
  }))
}

export interface OrganismSummary {
  readonly organismId: number
  readonly name: string
  readonly geneCount: number
  readonly recordCount: number
}

/**
 * Organisms present in a dataset, most abundant first.
 *
 * Bulk BioGRID sets are rarely single-organism — the coronavirus set alone spans
 * SARS-CoV-2, human, mouse and a dozen others — so the UI offers this as the primary
 * filter, replacing ProLiVis 1.0's fixed 48-organism dropdown.
 */
export async function listOrganisms(
  engine: DuckDBEngine,
  datasetId: string,
): Promise<OrganismSummary[]> {
  const id = sqlString(datasetId)
  const rows = await engine.rows<{
    organism_id: number
    organism_name: string | null
    gene_count: bigint | number
    record_count: bigint | number
  }>(`
    SELECT
      g.organism_id,
      any_value(g.organism_name) AS organism_name,
      count(*)                   AS gene_count,
      (SELECT count(*) FROM interactions i
        WHERE i.dataset_id = ${id}
          AND (i.organism_id_a = g.organism_id OR i.organism_id_b = g.organism_id))
                                 AS record_count
    FROM genes g
    WHERE g.dataset_id = ${id} AND g.organism_id IS NOT NULL
    GROUP BY g.organism_id
    ORDER BY record_count DESC`)

  return rows.map((r) => ({
    organismId: Number(r.organism_id),
    name: r.organism_name ?? `taxid ${r.organism_id}`,
    geneCount: num(r.gene_count),
    recordCount: num(r.record_count),
  }))
}

export interface ExperimentalSystemSummary {
  readonly name: string
  readonly type: string
  readonly recordCount: number
  readonly publicationCount: number
  readonly pairCount: number
}

/**
 * Experimental systems present in a dataset. These are the ring-1 nodes of the center
 * layout, and their publication counts determine each one's angular sector.
 */
export async function listExperimentalSystems(
  engine: DuckDBEngine,
  datasetId: string,
  organismId?: number,
): Promise<ExperimentalSystemSummary[]> {
  const filter = organismFilter(datasetId, organismId)
  const rows = await engine.rows<{
    experimental_system: string | null
    experimental_system_type: string | null
    record_count: bigint | number
    publication_count: bigint | number
    pair_count: bigint | number
  }>(`
    SELECT
      experimental_system,
      any_value(experimental_system_type) AS experimental_system_type,
      count(*)                            AS record_count,
      count(DISTINCT publication_key)     AS publication_count,
      count(DISTINCT pair_key)            AS pair_count
    FROM interactions
    WHERE ${filter} AND experimental_system IS NOT NULL
    GROUP BY experimental_system
    ORDER BY publication_count DESC, record_count DESC`)

  return rows.map((r) => ({
    name: r.experimental_system ?? 'Unknown',
    type: r.experimental_system_type ?? 'physical',
    recordCount: num(r.record_count),
    publicationCount: num(r.publication_count),
    pairCount: num(r.pair_count),
  }))
}

/**
 * SQL predicate selecting a dataset, optionally narrowed to one organism.
 *
 * A record is kept when *either* interactor belongs to the organism, so host–pathogen
 * interactions survive the filter. Dropping them would hide precisely the biology that
 * cross-species BioGRID sets exist to capture.
 */
export function organismFilter(
  datasetId: string,
  organismId?: number,
  alias?: string,
): string {
  // Qualify columns when the caller's query joins another table. Rewriting the
  // finished string with a regex instead would risk mangling the quoted dataset id.
  const q = alias ? `${alias}.` : ''
  const base = `${q}dataset_id = ${sqlString(datasetId)}`
  if (organismId === undefined) return base
  return `${base} AND (${q}organism_id_a = ${organismId} OR ${q}organism_id_b = ${organismId})`
}
