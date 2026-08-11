/**
 * Streaming zip reading for BioGRID bulk downloads.
 *
 * Sizing drives the design here. `BIOGRID-CORONAVIRUS-5.0.260.tab3.txt` is 44 MB
 * uncompressed from a 4.5 MB zip; `BIOGRID-ALL` is an order of magnitude larger. So we
 * never materialize a decompressed member in memory: entries are inflated in fflate's
 * own workers and handed out as line-aligned chunks, with the zip reader throttled
 * whenever the consumer falls behind.
 *
 * `BIOGRID-ORGANISM-LATEST.tab3.zip` also holds one member *per organism* (~80 of
 * them), which is why listing entries is a separate, cheap operation: entries whose
 * `start()` is never called are skipped without being inflated.
 */

import { AsyncUnzipInflate, Unzip, type UnzipFile } from 'fflate'

export interface ZipEntry {
  readonly name: string
  /** Uncompressed size in bytes, or null when the producer omitted it. */
  readonly originalSize: number | null
  readonly compressedSize: number | null
}

/** Bytes of zip data pushed per pump step. */
const ZIP_READ_CHUNK = 1 << 20

/** Stop pumping the zip while this many inflated bytes are queued. */
const MAX_QUEUED_BYTES = 64 << 20

const decoder = new TextDecoder('utf-8')

/**
 * List the members of a zip without inflating any of them.
 *
 * fflate reports each entry's header as it is reached; because we never call
 * `start()`, the compressed payloads are skipped rather than decompressed.
 */
export async function listZipEntries(file: Blob): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  const unzip = new Unzip()
  unzip.register(AsyncUnzipInflate)
  unzip.onfile = (entry: UnzipFile) => {
    entries.push({
      name: entry.name,
      // Absent for archives written in a streaming fashion; progress then falls back
      // to indeterminate rather than reporting a wrong percentage.
      originalSize: entry.originalSize ?? null,
      compressedSize: entry.size ?? null,
    })
  }

  const reader = file.stream().getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        unzip.push(new Uint8Array(0), true)
        break
      }
      unzip.push(value, false)
    }
  } finally {
    reader.releaseLock()
  }
  return entries
}

/** Pick the member to ingest when the caller did not choose one. */
export function chooseTab3Entry(entries: readonly ZipEntry[]): ZipEntry | null {
  const candidates = entries.filter(
    (e) => !e.name.startsWith('__MACOSX/') && /\.(txt|tsv|tab3)$/i.test(e.name),
  )
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0] ?? null
  // Ambiguous (e.g. the ORGANISM bundle): the caller must choose.
  return null
}

export interface TextChunk {
  /** UTF-8 text ending on a line boundary; never splits a record. */
  readonly text: string
  /** Uncompressed bytes emitted so far, for progress reporting. */
  readonly bytesRead: number
  readonly isFinal: boolean
}

export interface ReadEntryOptions {
  /** Approximate size of each emitted chunk, in bytes. */
  readonly chunkBytes?: number
  readonly signal?: AbortSignal
}

/**
 * Stream one zip member as line-aligned UTF-8 chunks.
 *
 * Chunks are cut at the last newline so that a caller feeding them to a CSV reader
 * never sees a truncated record. Multi-byte UTF-8 sequences are safe for the same
 * reason: a newline can never fall inside one.
 */
export async function* readZipEntryLines(
  file: Blob,
  entryName: string,
  options: ReadEntryOptions = {},
): AsyncGenerator<TextChunk> {
  const chunkBytes = options.chunkBytes ?? 24 << 20
  const queue = new ChunkQueue()

  const unzip = new Unzip()
  unzip.register(AsyncUnzipInflate)
  unzip.onfile = (entry: UnzipFile) => {
    if (entry.name !== entryName) return
    entry.ondata = (err, data, final) => {
      if (err) queue.fail(err)
      else queue.push(data, final)
    }
    entry.start()
  }

  // Pump the compressed bytes in the background, pausing while the consumer lags.
  const pump = (async () => {
    const reader = file.stream().getReader()
    try {
      for (;;) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        await queue.waitForDrain(MAX_QUEUED_BYTES)
        const { done, value } = await reader.read()
        if (done) {
          unzip.push(new Uint8Array(0), true)
          break
        }
        for (let off = 0; off < value.length; off += ZIP_READ_CHUNK) {
          unzip.push(value.subarray(off, off + ZIP_READ_CHUNK), false)
        }
      }
    } catch (e) {
      queue.fail(e instanceof Error ? e : new Error(String(e)))
    } finally {
      reader.releaseLock()
    }
  })()

  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let bytesRead = 0
  let sawEntry = false

  const flush = (final: boolean): TextChunk | null => {
    if (pendingBytes === 0) return final ? { text: '', bytesRead, isFinal: true } : null

    const joined = concat(pending, pendingBytes)
    let cut = joined.length
    if (!final) {
      cut = joined.lastIndexOf(0x0a) + 1 // keep the trailing newline
      if (cut === 0) return null // no complete line yet; keep buffering
    }

    const emit = joined.subarray(0, cut)
    const rest = joined.subarray(cut)
    pending = rest.length > 0 ? [rest] : []
    pendingBytes = rest.length

    return { text: decoder.decode(emit), bytesRead, isFinal: final }
  }

  try {
    for (;;) {
      const next = await queue.next()
      if (next === null) break
      sawEntry = true
      pending.push(next.data)
      pendingBytes += next.data.length
      bytesRead += next.data.length

      if (pendingBytes >= chunkBytes) {
        const chunk = flush(false)
        if (chunk) yield chunk
      }
      if (next.final) break
    }

    const tail = flush(true)
    if (tail) yield tail
  } finally {
    queue.close()
    await pump.catch(() => undefined)
  }

  if (!sawEntry) {
    throw new Error(`Zip archive has no entry named "${entryName}"`)
  }
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0]
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

interface QueueItem {
  readonly data: Uint8Array
  readonly final: boolean
}

/**
 * Bridges fflate's callback output to async iteration, and lets the producer wait
 * until the consumer has caught up. Without the drain signal, inflating a large member
 * would outrun the database inserts and buffer the whole file in memory — exactly what
 * this module exists to avoid.
 */
class ChunkQueue {
  private items: QueueItem[] = []
  private queuedBytes = 0
  private error: Error | null = null
  private closed = false
  private wakeConsumer: (() => void) | null = null
  private wakeProducer: (() => void) | null = null

  push(data: Uint8Array, final: boolean): void {
    if (this.closed) return
    if (data.length > 0 || final) {
      this.items.push({ data, final })
      this.queuedBytes += data.length
    }
    this.wakeConsumer?.()
    this.wakeConsumer = null
  }

  fail(error: Error): void {
    this.error = error
    this.wakeConsumer?.()
    this.wakeConsumer = null
    this.wakeProducer?.()
    this.wakeProducer = null
  }

  close(): void {
    this.closed = true
    this.wakeProducer?.()
    this.wakeProducer = null
  }

  async next(): Promise<QueueItem | null> {
    for (;;) {
      if (this.error) throw this.error
      const item = this.items.shift()
      if (item) {
        this.queuedBytes -= item.data.length
        this.wakeProducer?.()
        this.wakeProducer = null
        return item
      }
      if (this.closed) return null
      await new Promise<void>((resolve) => {
        this.wakeConsumer = resolve
      })
    }
  }

  async waitForDrain(limit: number): Promise<void> {
    while (this.queuedBytes > limit && !this.closed && !this.error) {
      await new Promise<void>((resolve) => {
        this.wakeProducer = resolve
      })
    }
    if (this.error) throw this.error
  }
}
