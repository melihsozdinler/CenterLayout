/**
 * Loading BioGRID tab3 data into DuckDB.
 *
 * Two paths, both landing in the same tables:
 *
 *   - A plain `.tab3.txt` is registered as a file handle and read lazily by DuckDB.
 *     Nothing is copied into memory, so the file may be arbitrarily large.
 *   - A `.zip` is inflated in line-aligned chunks (see `zip.ts`), each registered as a
 *     small buffer and inserted, then dropped. Peak memory stays at one chunk
 *     regardless of the archive size.
 */

import type { DuckDBEngine } from './duckdb'
import { listZipEntries, readZipEntryLines, type ZipEntry } from './zip'
import { parseTab3Header, Tab3FormatError, type Tab3Header } from './tab3'
import {
  buildGenesInsert,
  buildInteractionSelect,
  buildPublicationsInsert,
  sqlString,
} from '../model/schema'

export interface IngestProgress {
  readonly phase: 'reading' | 'inserting' | 'indexing' | 'summarizing' | 'done'
  /** 0..1 when determinable, otherwise null. */
  readonly fraction: number | null
  readonly recordsLoaded: number
  readonly message: string
}

export interface IngestOptions {
  /** Display name for the dataset; defaults to a name derived from the file. */
  readonly label?: string
  /** Which member of a multi-entry zip to load. */
  readonly entryName?: string
  readonly onProgress?: (p: IngestProgress) => void
  readonly signal?: AbortSignal
  /** Chunk size override, used by tests to exercise the multi-chunk path. */
  readonly chunkBytes?: number
}

export interface IngestResult {
  readonly datasetId: string
  readonly label: string
  readonly recordCount: number
  readonly geneCount: number
  readonly publicationCount: number
  readonly pairCount: number
  readonly biogridRelease: string | null
}

/**
 * BioGRID names its dumps `BIOGRID-<SET>-<RELEASE>.tab3.txt`, where `<SET>` may itself
 * contain hyphens and underscores — members of the ORGANISM bundle look like
 * `BIOGRID-ORGANISM-Homo_sapiens-4.4.246.tab3.txt`. The release is the last
 * dotted-numeric segment.
 *
 * Recovering it is what makes cross-release comparison meaningful, so it is parsed
 * rather than asked for. `-LATEST` aliases carry no release, and we say so instead of
 * inventing one.
 */
export function parseBiogridRelease(fileName: string): string | null {
  const base = baseName(fileName)
  const m = /^BIOGRID-.+-(\d+\.\d+\.\d+)$/i.exec(base)
  return m?.[1] ?? null
}

/** Human-readable dataset label derived from a BioGRID filename. */
export function labelFromFileName(fileName: string): string {
  const base = baseName(fileName)
  const m = /^BIOGRID-(.+)-(\d+\.\d+\.\d+|LATEST)$/i.exec(base)
  if (m?.[1] && m[2]) {
    // "ORGANISM-Homo_sapiens" reads better as "ORGANISM Homo sapiens".
    return `${m[1].replace(/[_-]/g, ' ')} ${m[2]}`
  }
  return base
}

/** Strip any directory prefix and the tab3/zip extensions. */
function baseName(fileName: string): string {
  return fileName
    .replace(/^.*\//, '')
    .replace(/\.zip$/i, '')
    .replace(/\.(tab3|tab2|mitab)$/i, '')
    .replace(/\.(txt|tsv)$/i, '')
    .replace(/\.(tab3|tab2|mitab)$/i, '')
}

let datasetCounter = 0

function nextDatasetId(): string {
  datasetCounter += 1
  return `ds${datasetCounter}_${Math.random().toString(36).slice(2, 8)}`
}

const isZip = (name: string) => /\.zip$/i.test(name)

/** Inspect a dropped file so the UI can ask which member to load, if several. */
export async function inspectFile(file: File): Promise<ZipEntry[] | null> {
  if (!isZip(file.name)) return null
  const entries = await listZipEntries(file)
  return entries.filter((e) => !e.name.startsWith('__MACOSX/'))
}

/** Load a BioGRID tab3 file (zipped or plain) as a new dataset. */
export async function ingestFile(
  engine: DuckDBEngine,
  file: File,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const datasetId = nextDatasetId()
  const report = options.onProgress ?? (() => undefined)
  let recordsLoaded = 0

  const entryName = options.entryName
  const sourceName = entryName ?? file.name
  const label = options.label ?? labelFromFileName(sourceName)
  const release = parseBiogridRelease(sourceName)

  await engine.exec(`
    INSERT INTO datasets (dataset_id, label, source_kind, source_detail, biogrid_release,
                          loaded_at, record_count)
    VALUES (${sqlString(datasetId)}, ${sqlString(label)}, 'file',
            ${sqlString(sourceName)},
            ${release === null ? 'NULL' : sqlString(release)},
            now(), 0)`)

  try {
    if (isZip(file.name)) {
      recordsLoaded = await ingestZip(engine, file, datasetId, options, report)
    } else {
      recordsLoaded = await ingestPlainFile(engine, file, datasetId, report)
    }

    report({
      phase: 'summarizing',
      fraction: null,
      recordsLoaded,
      message: 'Building gene and publication dictionaries',
    })
    await engine.exec(buildGenesInsert(datasetId))
    await engine.exec(buildPublicationsInsert(datasetId))

    report({
      phase: 'indexing',
      fraction: null,
      recordsLoaded,
      message: 'Creating indexes',
    })
    await engine.createIndexes()

    await engine.exec(
      `UPDATE datasets SET record_count = ${recordsLoaded}
       WHERE dataset_id = ${sqlString(datasetId)}`,
    )

    const summary = await engine.row<{
      genes: bigint | number
      publications: bigint | number
      pairs: bigint | number
    }>(`
      SELECT
        (SELECT count(*) FROM genes WHERE dataset_id = ${sqlString(datasetId)})        AS genes,
        (SELECT count(*) FROM publications WHERE dataset_id = ${sqlString(datasetId)}) AS publications,
        (SELECT count(DISTINCT pair_key) FROM interactions
          WHERE dataset_id = ${sqlString(datasetId)})                                  AS pairs`)

    report({ phase: 'done', fraction: 1, recordsLoaded, message: 'Loaded' })

    return {
      datasetId,
      label,
      recordCount: recordsLoaded,
      geneCount: Number(summary?.genes ?? 0),
      publicationCount: Number(summary?.publications ?? 0),
      pairCount: Number(summary?.pairs ?? 0),
      biogridRelease: release,
    }
  } catch (error) {
    // Never leave a half-loaded dataset behind: a partial ingest would quietly
    // understate evidence counts and so inflate or deflate every trust score.
    await removeDataset(engine, datasetId).catch(() => undefined)
    throw error
  }
}

async function ingestPlainFile(
  engine: DuckDBEngine,
  file: File,
  datasetId: string,
  report: (p: IngestProgress) => void,
): Promise<number> {
  const headerLine = await readFirstLine(file)
  const header = parseTab3Header(headerLine)

  const registered = `${datasetId}_source.tsv`
  await engine.registerFile(registered, file)
  try {
    report({
      phase: 'inserting',
      fraction: null,
      recordsLoaded: 0,
      message: `Reading ${file.name}`,
    })
    return engine.execCount(
      `INSERT INTO interactions ${buildInteractionSelect(header, datasetId, registered)}`,
    )
  } finally {
    await engine.dropFile(registered)
  }
}

async function ingestZip(
  engine: DuckDBEngine,
  file: File,
  datasetId: string,
  options: IngestOptions,
  report: (p: IngestProgress) => void,
): Promise<number> {
  const entries = await listZipEntries(file)
  const usable = entries.filter((e) => !e.name.startsWith('__MACOSX/'))
  const entryName = options.entryName ?? pickSingleEntry(usable)

  const entry = usable.find((e) => e.name === entryName)
  const totalBytes = entry?.originalSize ?? null

  let header: Tab3Header | null = null
  let headerLine = ''
  let chunkIndex = 0
  let recordsLoaded = 0

  for await (const chunk of readZipEntryLines(file, entryName, {
    chunkBytes: options.chunkBytes ?? undefined,
    signal: options.signal ?? undefined,
  })) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (chunk.text === '') continue

    let body = chunk.text
    if (header === null) {
      const nl = body.indexOf('\n')
      if (nl === -1) {
        throw new Tab3FormatError(`"${entryName}" has no complete header line`)
      }
      headerLine = body.slice(0, nl)
      header = parseTab3Header(headerLine)
      body = body.slice(nl + 1)
      if (body === '') continue
    }

    // Every chunk is fed to read_csv with the header prepended, so DuckDB sees a
    // well-formed file each time and column resolution stays name-based.
    const registered = `${datasetId}_chunk${chunkIndex}.tsv`
    chunkIndex += 1
    await engine.registerBuffer(registered, new TextEncoder().encode(`${headerLine}\n${body}`))
    try {
      // Take the affected-row count from the INSERT itself. Re-counting the table
      // after every chunk would make a full-release load quadratic in chunk count.
      recordsLoaded += await engine.execCount(
        `INSERT INTO interactions ${buildInteractionSelect(header, datasetId, registered)}`,
      )
    } finally {
      await engine.dropFile(registered)
    }

    report({
      phase: 'inserting',
      fraction: totalBytes ? Math.min(1, chunk.bytesRead / totalBytes) : null,
      recordsLoaded,
      message: `Loaded ${recordsLoaded.toLocaleString()} records`,
    })
  }

  if (header === null) {
    throw new Tab3FormatError(`"${entryName}" appears to be empty`)
  }
  return recordsLoaded
}

function pickSingleEntry(entries: readonly ZipEntry[]): string {
  const candidates = entries.filter((e) => /\.(txt|tsv|tab3)$/i.test(e.name))
  const only = candidates.length === 1 ? candidates[0] : undefined
  if (only) return only.name

  if (candidates.length === 0) {
    throw new Tab3FormatError(
      'That zip contains no .txt member. BioGRID tab3 downloads are named ' +
        'BIOGRID-<SET>-<RELEASE>.tab3.zip.',
    )
  }
  throw new Tab3FormatError(
    `That archive contains ${candidates.length} files (BIOGRID-ORGANISM bundles hold ` +
      'one per organism). Choose which one to load.',
  )
}

/** Read up to the first newline of a file without loading the rest. */
async function readFirstLine(file: Blob, maxBytes = 1 << 16): Promise<string> {
  const head = await file.slice(0, maxBytes).text()
  const nl = head.indexOf('\n')
  if (nl === -1) {
    throw new Tab3FormatError('File has no header line in its first 64 KB')
  }
  return head.slice(0, nl)
}

/** Delete a dataset and everything derived from it. */
export async function removeDataset(
  engine: DuckDBEngine,
  datasetId: string,
): Promise<void> {
  const id = sqlString(datasetId)
  for (const table of ['interactions', 'genes', 'publications', 'datasets']) {
    await engine.exec(`DELETE FROM ${table} WHERE dataset_id = ${id}`)
  }
}
