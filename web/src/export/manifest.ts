/**
 * The session manifest.
 *
 * A figure is only reproducible if someone else can state exactly what produced it.
 * This records that: the BioGRID release, the query, the filters, the trust
 * configuration and the layout options, alongside the tool version that read them.
 *
 * ProLiVis 1.0's figures could not be regenerated even by their author — the layout
 * engine was a separate binary and nothing recorded its inputs. A manifest plus a
 * deterministic layout is the fix, and it is cheap: a small JSON file next to the SVG.
 */

import { APP_NAME, APP_VERSION } from '../app-info'
import type { CenterLayoutOptions } from '../views/center-layout'
import type { EvidenceQuery } from '../trust/score'
import type { TrustConfig } from '../trust/model'
import type { DatasetSummary } from '../model/datasets'

export const MANIFEST_KIND = 'prolivis.session'
export const MANIFEST_VERSION = 1

export interface DatasetProvenance {
  readonly label: string
  readonly sourceKind: string
  readonly sourceDetail: string | null
  readonly biogridRelease: string | null
  readonly recordCount: number
  readonly pairCount: number
  readonly publicationCount: number
  /** ISO 8601, so a reader can tell how stale the underlying data is. */
  readonly loadedAt: string
}

export interface SessionManifest {
  readonly kind: typeof MANIFEST_KIND
  readonly manifestVersion: number
  readonly tool: { readonly name: string; readonly version: string }
  readonly dataset: DatasetProvenance
  readonly query: EvidenceQuery | null
  readonly trust: {
    readonly preset: string
    readonly weights: Record<string, number>
    readonly constants: Record<string, number>
  } | null
  readonly layout: CenterLayoutOptions | null
  readonly organismId: number | null
  /** Free-text note from the user, e.g. what the figure is meant to show. */
  readonly note: string | null
  /**
   * Stamped by the caller, not read from the clock here, so that generating a
   * manifest stays a pure function of its inputs and can be tested.
   */
  readonly createdAt: string | null
}

export interface BuildManifestInput {
  readonly dataset: DatasetSummary
  readonly query?: EvidenceQuery
  readonly trust?: TrustConfig
  readonly layout?: CenterLayoutOptions
  readonly organismId?: number
  readonly note?: string
  readonly createdAt?: string
}

export function buildManifest(input: BuildManifestInput): SessionManifest {
  return {
    kind: MANIFEST_KIND,
    manifestVersion: MANIFEST_VERSION,
    tool: { name: APP_NAME, version: APP_VERSION },
    dataset: {
      label: input.dataset.label,
      sourceKind: input.dataset.sourceKind,
      sourceDetail: input.dataset.sourceDetail,
      biogridRelease: input.dataset.biogridRelease,
      recordCount: input.dataset.recordCount,
      pairCount: input.dataset.pairCount,
      publicationCount: input.dataset.publicationCount,
      loadedAt: input.dataset.loadedAt.toISOString(),
    },
    query: input.query ?? null,
    trust: input.trust
      ? {
          preset: input.trust.name,
          weights: { ...input.trust.weights },
          constants: { ...input.trust.constants },
        }
      : null,
    layout: input.layout ?? null,
    organismId: input.organismId ?? null,
    note: input.note ?? null,
    createdAt: input.createdAt ?? null,
  }
}

export function serializeManifest(manifest: SessionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

/**
 * Parse a manifest, refusing anything that is not one.
 *
 * A manifest from a future version is accepted with a warning rather than rejected:
 * the fields we understand are still useful, and refusing outright would strand a
 * user's saved figure the first time the format grows.
 */
export function parseManifest(text: string): {
  manifest: SessionManifest
  warnings: string[]
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new ManifestError(`Not valid JSON: ${String(cause)}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ManifestError('Manifest must be a JSON object')
  }
  const record = parsed as Record<string, unknown>
  if (record['kind'] !== MANIFEST_KIND) {
    throw new ManifestError(
      `Not a ProLiVis session manifest (kind was ${JSON.stringify(record['kind'])})`,
    )
  }

  const warnings: string[] = []
  const version = Number(record['manifestVersion'] ?? 0)
  if (version > MANIFEST_VERSION) {
    warnings.push(
      `This manifest was written by a newer version of ${APP_NAME} ` +
        `(format ${version}, this build understands ${MANIFEST_VERSION}). ` +
        'Unknown settings will be ignored.',
    )
  }

  const dataset = record['dataset'] as Record<string, unknown> | undefined
  if (!dataset || typeof dataset['label'] !== 'string') {
    throw new ManifestError('Manifest is missing its dataset provenance')
  }

  return { manifest: record as unknown as SessionManifest, warnings }
}

/**
 * Whether a manifest can be reproduced against a dataset currently loaded.
 *
 * Reports rather than decides: a release mismatch is often exactly what a user wants
 * to see (that is a cross-release comparison), so it is surfaced, not blocked.
 */
export function checkReproducibility(
  manifest: SessionManifest,
  available: readonly DatasetSummary[],
): { match: DatasetSummary | null; problems: string[] } {
  const problems: string[] = []

  const byRelease = available.filter(
    (d) =>
      manifest.dataset.biogridRelease !== null &&
      d.biogridRelease === manifest.dataset.biogridRelease,
  )
  const byLabel = available.filter((d) => d.label === manifest.dataset.label)
  const match = byRelease[0] ?? byLabel[0] ?? null

  if (!match) {
    problems.push(
      `No loaded dataset matches "${manifest.dataset.label}"` +
        (manifest.dataset.biogridRelease
          ? ` (BioGRID ${manifest.dataset.biogridRelease})`
          : '') +
        '. Load it to reproduce this figure exactly.',
    )
    return { match: null, problems }
  }

  if (
    manifest.dataset.biogridRelease !== null &&
    match.biogridRelease !== manifest.dataset.biogridRelease
  ) {
    problems.push(
      `Release differs: the figure was made from BioGRID ` +
        `${manifest.dataset.biogridRelease}, the loaded dataset is ` +
        `${match.biogridRelease ?? 'unknown'}. Results will differ where the ` +
        'database has changed.',
    )
  }
  if (match.recordCount !== manifest.dataset.recordCount) {
    problems.push(
      `Record count differs: ${manifest.dataset.recordCount.toLocaleString()} when the ` +
        `figure was made, ${match.recordCount.toLocaleString()} now.`,
    )
  }

  return { match, problems }
}
