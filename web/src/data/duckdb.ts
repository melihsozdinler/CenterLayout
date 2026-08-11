/**
 * DuckDB-WASM engine.
 *
 * Two decisions worth stating:
 *
 * 1. **The WASM and worker assets are bundled, not fetched from a CDN.** duckdb-wasm's
 *    documented setup uses jsDelivr; that would make the app silently require the
 *    network on every cold start and break the air-gapped install we promise. Vite's
 *    `?url` imports make the bundler emit the assets alongside the app instead.
 *
 * 2. **We select the `eh` bundle, never `coi`.** The multi-threaded build needs
 *    `SharedArrayBuffer`, which needs COOP/COEP response headers, which GitHub Pages
 *    cannot set. Single-threaded exception-handling build it is.
 */

import * as duckdb from '@duckdb/duckdb-wasm'
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { Table } from 'apache-arrow'

import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'

import { DDL, INDEXES, PAIR_VIEW, SCHEMA_VERSION } from '../model/schema'

/** Path of the persistent database inside the Origin Private File System. */
export const OPFS_DB_PATH = 'opfs://prolivis.duckdb'

export interface EngineOptions {
  /**
   * Persist to OPFS so a loaded dataset survives a reload. Disabled automatically
   * when the browser has no usable OPFS (Safari private browsing, older Firefox),
   * in which case the database is in-memory and lost on reload.
   */
  readonly persist?: boolean
}

export interface EngineInfo {
  readonly persistent: boolean
  readonly duckdbVersion: string
}

/**
 * OPFS needs both the API and a working synchronous access handle inside a worker.
 * Feature-detecting the API alone gives false positives, so probe for real.
 */
export async function opfsAvailable(): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) return false
    const root = await navigator.storage.getDirectory()
    const probe = await root.getFileHandle('.prolivis-probe', { create: true })
    await root.removeEntry('.prolivis-probe')
    return probe !== undefined
  } catch {
    return false
  }
}

export class DuckDBEngine {
  private constructor(
    private readonly db: AsyncDuckDB,
    private readonly conn: AsyncDuckDBConnection,
    readonly info: EngineInfo,
  ) {}

  static async create(options: EngineOptions = {}): Promise<DuckDBEngine> {
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
      eh: { mainModule: ehWasm, mainWorker: ehWorker },
    })
    if (!bundle.mainWorker) {
      throw new Error('duckdb-wasm did not resolve a worker for this browser')
    }

    const worker = new Worker(bundle.mainWorker, { type: 'module' })
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)

    const wantPersist = options.persist ?? true
    const persistent = wantPersist && (await opfsAvailable())

    await db.open({
      ...(persistent ? { path: OPFS_DB_PATH } : {}),
      accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
      // Single-threaded: SharedArrayBuffer is unavailable without cross-origin isolation.
      maximumThreads: 1,
      opfs: { fileHandling: 'manual' },
      query: {
        // Interaction ids and counts exceed 2^53 only in aggregate; keeping BigInt
        // as BigInt avoids silent precision loss in exported data.
        castBigIntToDouble: false,
      },
    })

    const conn = await db.connect()
    const version = await db.getVersion()
    const engine = new DuckDBEngine(db, conn, { persistent, duckdbVersion: version })
    await engine.migrate()
    return engine
  }

  /**
   * Create the schema, or wipe and recreate it if it was written by an older version
   * of the app. A cached dataset is cheap to re-ingest; a subtly wrong schema is not.
   */
  private async migrate(): Promise<void> {
    await this.conn.query(
      `CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL)`,
    )
    const stored = await this.scalar<string>(
      `SELECT value FROM meta WHERE key = 'schema_version'`,
    )
    const existing = stored === null ? null : Number(String(stored))

    if (existing !== null && existing !== SCHEMA_VERSION) {
      for (const table of ['interactions', 'genes', 'publications', 'datasets']) {
        await this.conn.query(`DROP TABLE IF EXISTS ${table}`)
      }
      await this.conn.query(`DROP VIEW IF EXISTS ppi_pairs`)
    }

    for (const statement of DDL) await this.conn.query(statement)
    await this.conn.query(PAIR_VIEW)
    await this.conn.query(
      `INSERT OR REPLACE INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`,
    )
  }

  /** Run a statement, discarding the result. */
  async exec(sql: string): Promise<void> {
    await this.conn.query(sql)
  }

  /**
   * Run an INSERT/UPDATE/DELETE and return the number of rows it affected.
   *
   * DuckDB reports this directly, which matters during a chunked bulk load: asking
   * `SELECT count(*)` after each chunk instead would make ingest quadratic in the
   * number of chunks.
   */
  async execCount(sql: string): Promise<number> {
    const result = await this.conn.query(sql)
    const first = (result.toArray() as unknown as Record<string, unknown>[])[0]
    const value = first ? Object.values(first)[0] : undefined
    return value === undefined || value === null ? 0 : Number(value)
  }

  /**
   * Run a query and return the Arrow table. Prefer this for large result sets: the
   * columnar batches can be consumed without materializing JS objects per row.
   */
  async arrow(sql: string): Promise<Table> {
    return (await this.conn.query(sql)) as unknown as Table
  }

  /** Run a query and return plain JS objects. Only for small result sets. */
  async rows<T>(sql: string): Promise<T[]> {
    const table = await this.arrow(sql)
    return table.toArray() as unknown as T[]
  }

  /** Run a query expected to return exactly one row, or null when empty. */
  async row<T>(sql: string): Promise<T | null> {
    const all = await this.rows<T>(sql)
    return all[0] ?? null
  }

  /** Scalar helper for counts and similar single-value queries. */
  async scalar<T = unknown>(sql: string): Promise<T | null> {
    const r = await this.row<Record<string, unknown>>(sql)
    if (r === null) return null
    const first = Object.values(r)[0]
    return (first ?? null) as T | null
  }

  /** Make an in-memory buffer visible to SQL as `name`. */
  async registerBuffer(name: string, bytes: Uint8Array): Promise<void> {
    await this.db.registerFileBuffer(name, bytes)
  }

  /**
   * Make a `File` visible to SQL as `name` without reading it into memory. DuckDB
   * pulls only the ranges it needs, which is what lets an uncompressed multi-gigabyte
   * dump be queried on a laptop.
   */
  async registerFile(name: string, file: File): Promise<void> {
    await this.db.registerFileHandle(
      name,
      file,
      duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
      true,
    )
  }

  async dropFile(name: string): Promise<void> {
    try {
      await this.db.dropFile(name)
    } catch {
      // Already gone; nothing to do.
    }
  }

  /** Build the secondary indexes. Called once after a bulk load, never before. */
  async createIndexes(): Promise<void> {
    for (const statement of INDEXES) await this.conn.query(statement)
  }

  /**
   * Delete every loaded dataset, leaving the schema in place.
   *
   * Needed because the database is persistent: without an explicit wipe, a BioGRID
   * release ingested months ago would still be sitting in the user's browser storage.
   */
  async wipe(): Promise<void> {
    for (const table of ['interactions', 'genes', 'publications', 'datasets']) {
      await this.conn.query(`DELETE FROM ${table}`)
    }
  }

  async close(): Promise<void> {
    await this.conn.close()
    await this.db.terminate()
  }
}

let singleton: Promise<DuckDBEngine> | null = null

/** Process-wide engine. Created on first use. */
export function getEngine(options?: EngineOptions): Promise<DuckDBEngine> {
  singleton ??= DuckDBEngine.create(options)
  return singleton
}

/** Test/teardown helper; drops the singleton so the next call rebuilds it. */
export async function resetEngine(): Promise<void> {
  const current = singleton
  singleton = null
  if (current) {
    try {
      await (await current).close()
    } catch {
      // Engine failed to start; nothing to close.
    }
  }
}
