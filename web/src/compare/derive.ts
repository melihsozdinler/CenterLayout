/**
 * Deriving a new dataset from part of an existing one.
 *
 * Scoping the view to a publication answers "what did this paper report" for as long
 * as you are looking at it. Deriving turns that into an object: gather a set of
 * publications — a reading list, a lab's output, everything using one technique — and
 * keep the interactions they report as a dataset in its own right, which can then be
 * scored, compared, merged, exported and reopened next week like any other.
 *
 * The derived dataset records what produced it. A network assembled from a chosen
 * subset of the literature is a claim about that subset, and one that cannot say which
 * publications it came from is not reproducible.
 */

import type { DuckDBEngine } from '../data/duckdb'
import {
  buildGenesInsert,
  buildPublicationsInsert,
  sqlString,
} from '../model/schema'

export interface DeriveQuery {
  /** Dataset to take records from. */
  readonly datasetId: string
  /** Keep only records from these publications. */
  readonly publications?: readonly string[]
  /** Keep only records using these experimental systems. */
  readonly systems?: readonly string[]
  /** Keep only records touching this organism. */
  readonly organismId?: number
  readonly label?: string
  readonly notes?: string
}

export interface DeriveResult {
  readonly datasetId: string
  readonly label: string
  readonly recordCount: number
  readonly pairCount: number
  readonly publicationCount: number
  readonly geneCount: number
}

export class DeriveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeriveError'
  }
}

let deriveCounter = 0

/** A human-readable account of what was selected, stored as provenance. */
export function describeDerivation(query: DeriveQuery): string {
  const parts: string[] = []
  if (query.publications?.length) {
    parts.push(
      `${query.publications.length} publication${query.publications.length === 1 ? '' : 's'}`,
    )
  }
  if (query.systems?.length) parts.push(`methods: ${query.systems.join(', ')}`)
  if (query.organismId !== undefined) parts.push(`organism ${query.organismId}`)
  return parts.length > 0 ? parts.join(' · ') : 'everything'
}

/**
 * Copy the selected records into a new dataset.
 *
 * Records are copied rather than referenced. A derived dataset that pointed back at
 * its source would change under the user when the source was removed or reloaded, and
 * a figure made from it would stop being reproducible.
 */
export async function deriveDataset(
  engine: DuckDBEngine,
  query: DeriveQuery,
): Promise<DeriveResult> {
  const hasFilter =
    (query.publications?.length ?? 0) > 0 ||
    (query.systems?.length ?? 0) > 0 ||
    query.organismId !== undefined
  if (!hasFilter) {
    throw new DeriveError(
      'Select at least one publication, method or organism to derive a dataset from.',
    )
  }

  deriveCounter += 1
  const datasetId = `derived${deriveCounter}_${Math.random().toString(36).slice(2, 8)}`
  const description = describeDerivation(query)

  const source = await engine.row<{ label: string; biogrid_release: string | null }>(`
    SELECT label, biogrid_release FROM datasets
    WHERE dataset_id = ${sqlString(query.datasetId)}`)
  if (!source) {
    throw new DeriveError(`No dataset ${query.datasetId} is loaded.`)
  }

  const label = query.label?.trim() || `${description} from ${source.label}`

  const where = [`dataset_id = ${sqlString(query.datasetId)}`]
  if (query.publications?.length) {
    where.push(`publication_key IN (${query.publications.map(sqlString).join(', ')})`)
  }
  if (query.systems?.length) {
    where.push(`experimental_system IN (${query.systems.map(sqlString).join(', ')})`)
  }
  if (query.organismId !== undefined) {
    where.push(
      `(organism_id_a = ${query.organismId} OR organism_id_b = ${query.organismId})`,
    )
  }

  // The release is inherited: a derived set is still that release's data, and losing
  // the release would make it uncomparable with anything.
  await engine.exec(`
    INSERT INTO datasets (dataset_id, label, source_kind, source_detail, biogrid_release,
                          loaded_at, record_count, notes)
    VALUES (${sqlString(datasetId)}, ${sqlString(label)}, 'derived',
            ${sqlString(description)},
            ${source.biogrid_release === null ? 'NULL' : sqlString(source.biogrid_release)},
            now(), 0,
            ${sqlString(query.notes?.trim() || `Derived from ${source.label}: ${description}`)})`)

  try {
    const inserted = await engine.execCount(`
      INSERT INTO interactions
      SELECT * REPLACE (${sqlString(datasetId)} AS dataset_id)
      FROM interactions
      WHERE ${where.join(' AND ')}`)

    if (inserted === 0) {
      throw new DeriveError('That selection contains no interactions.')
    }

    await engine.exec(buildGenesInsert(datasetId))
    await engine.exec(buildPublicationsInsert(datasetId))
    await engine.exec(
      `UPDATE datasets SET record_count = ${inserted}
       WHERE dataset_id = ${sqlString(datasetId)}`,
    )
    await engine.createIndexes()
    await engine.checkpoint()

    const summary = await engine.row<{
      pairs: bigint | number
      publications: bigint | number
      genes: bigint | number
    }>(`
      SELECT
        (SELECT count(DISTINCT pair_key) FROM interactions
          WHERE dataset_id = ${sqlString(datasetId)})                        AS pairs,
        (SELECT count(*) FROM publications WHERE dataset_id = ${sqlString(datasetId)}) AS publications,
        (SELECT count(*) FROM genes WHERE dataset_id = ${sqlString(datasetId)})        AS genes`)

    return {
      datasetId,
      label,
      recordCount: inserted,
      pairCount: Number(summary?.pairs ?? 0),
      publicationCount: Number(summary?.publications ?? 0),
      geneCount: Number(summary?.genes ?? 0),
    }
  } catch (error) {
    // Never leave a half-built dataset behind: it would understate its own evidence
    // and quietly distort every trust score computed from it.
    for (const table of ['interactions', 'genes', 'publications', 'datasets']) {
      await engine
        .exec(`DELETE FROM ${table} WHERE dataset_id = ${sqlString(datasetId)}`)
        .catch(() => undefined)
    }
    throw error
  }
}
