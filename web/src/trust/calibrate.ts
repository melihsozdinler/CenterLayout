/**
 * Calibration: measuring whether the trust model actually separates believable
 * interactions from doubtful ones.
 *
 * A weighted sum of plausible-sounding terms is a hypothesis, not a result. This
 * module tests it the only way that means anything — against an external reference
 * set the model never saw — and reports AUROC plus a per-term ablation, so a reader
 * can see which terms are doing work and which are decoration.
 *
 * Reference sets are supplied by the user (CORUM complexes, hu.MAP co-complex pairs,
 * or any curated list). We ship none: bundling a gold standard would invite scoring
 * the model on the same data everyone tunes it against.
 */

import type { TrustConfig, TrustTerm } from './model'
import { TRUST_TERMS } from './model'
import type { GatheredEvidence, ScoredPair } from './score'
import { scoreWithIdentity } from './score'

/** A reference set of pairs known to interact, and pairs believed not to. */
export interface ReferenceSet {
  readonly name: string
  /** Pair keys, or `symbolA|symbolB` pairs, believed to be genuine interactions. */
  readonly positives: ReadonlySet<string>
  /**
   * Pairs believed not to interact. When absent, negatives are sampled from the
   * dataset's pairs that are not positives — a weaker design, since some of those are
   * true interactions not yet in the reference set, so the reported AUROC is a
   * conservative lower bound.
   */
  readonly negatives?: ReadonlySet<string>
}

export interface RocPoint {
  readonly falsePositiveRate: number
  readonly truePositiveRate: number
  readonly threshold: number
}

export interface CalibrationResult {
  readonly referenceSet: string
  readonly positives: number
  readonly negatives: number
  /** Area under the ROC curve. 0.5 is chance; 1.0 is perfect separation. */
  readonly auroc: number
  /** Average precision, which is more informative when positives are rare. */
  readonly averagePrecision: number
  readonly roc: readonly RocPoint[]
}

export interface AblationRow {
  /** The term removed, or null for the full model. */
  readonly removed: TrustTerm | null
  readonly auroc: number
  /** Change in AUROC caused by removing this term. Negative means the term helps. */
  readonly delta: number
}

/**
 * AUROC by the rank-sum identity, which is exact and needs no threshold sweep.
 *
 * Ties are credited a half, as they must be: a scorer that gives every pair the same
 * value should measure 0.5, not 1.0.
 */
export function auroc(
  positiveScores: readonly number[],
  negativeScores: readonly number[],
): number {
  const n = positiveScores.length
  const m = negativeScores.length
  if (n === 0 || m === 0) return Number.NaN

  const labelled = [
    ...positiveScores.map((s) => ({ s, positive: true })),
    ...negativeScores.map((s) => ({ s, positive: false })),
  ].sort((a, b) => a.s - b.s)

  // Average ranks within tied blocks.
  let rankSumPositive = 0
  let i = 0
  while (i < labelled.length) {
    let j = i
    while (j + 1 < labelled.length && labelled[j + 1]!.s === labelled[i]!.s) j += 1
    const averageRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) {
      if (labelled[k]!.positive) rankSumPositive += averageRank
    }
    i = j + 1
  }

  return (rankSumPositive - (n * (n + 1)) / 2) / (n * m)
}

/** Average precision: the area under the precision-recall curve. */
export function averagePrecision(
  positiveScores: readonly number[],
  negativeScores: readonly number[],
): number {
  const n = positiveScores.length
  if (n === 0) return Number.NaN

  const labelled = [
    ...positiveScores.map((s) => ({ s, positive: true })),
    ...negativeScores.map((s) => ({ s, positive: false })),
  ].sort((a, b) => b.s - a.s)

  let truePositives = 0
  let sum = 0
  labelled.forEach((item, index) => {
    if (item.positive) {
      truePositives += 1
      sum += truePositives / (index + 1)
    }
  })
  return sum / n
}

/** ROC curve points, for plotting in the paper. */
export function rocCurve(
  positiveScores: readonly number[],
  negativeScores: readonly number[],
): RocPoint[] {
  const n = positiveScores.length
  const m = negativeScores.length
  if (n === 0 || m === 0) return []

  const labelled = [
    ...positiveScores.map((s) => ({ s, positive: true })),
    ...negativeScores.map((s) => ({ s, positive: false })),
  ].sort((a, b) => b.s - a.s)

  const points: RocPoint[] = [
    { falsePositiveRate: 0, truePositiveRate: 0, threshold: Number.POSITIVE_INFINITY },
  ]
  let tp = 0
  let fp = 0
  let previous = Number.POSITIVE_INFINITY

  for (const item of labelled) {
    if (item.s !== previous) {
      points.push({ falsePositiveRate: fp / m, truePositiveRate: tp / n, threshold: previous })
      previous = item.s
    }
    if (item.positive) tp += 1
    else fp += 1
  }
  points.push({ falsePositiveRate: fp / m, truePositiveRate: tp / n, threshold: previous })
  return points
}

/**
 * Keys under which a scored pair might appear in a reference set: the internal pair
 * key, and the symbol pair in both orders, so a user-supplied CSV of gene symbols
 * works without preprocessing.
 *
 * Note the asymmetry this creates. Gene symbols are not unique across organisms, so a
 * symbol-keyed reference set can match several distinct gene-id pairs — in a
 * cross-species dataset, a reference entry for `N|M` matches the SARS-CoV-2, SARS-CoV
 * and MERS pairs alike. Prefer pair keys, or calibrate one organism at a time, when
 * that ambiguity would matter.
 */
export function referenceKeys(pair: ScoredPair): string[] {
  const keys = [pair.pairKey]
  if (pair.symbolLo && pair.symbolHi) {
    const a = pair.symbolLo.toUpperCase()
    const b = pair.symbolHi.toUpperCase()
    keys.push(`${a}|${b}`, `${b}|${a}`)
  }
  return keys
}

function partition(
  scored: readonly ScoredPair[],
  reference: ReferenceSet,
): { positives: number[]; negatives: number[] } {
  const positives: number[] = []
  const negatives: number[] = []

  for (const pair of scored) {
    const keys = referenceKeys(pair)
    if (keys.some((k) => reference.positives.has(k))) {
      positives.push(pair.score)
    } else if (reference.negatives) {
      if (keys.some((k) => reference.negatives!.has(k))) negatives.push(pair.score)
    } else {
      // No explicit negatives: everything unlabelled stands in. Some of these are
      // true interactions the reference set has not caught up with, so the resulting
      // AUROC understates the model rather than flattering it.
      negatives.push(pair.score)
    }
  }
  return { positives, negatives }
}

/** Evaluate a configuration against a reference set. */
export function calibrate(
  scored: readonly ScoredPair[],
  reference: ReferenceSet,
): CalibrationResult {
  const { positives, negatives } = partition(scored, reference)
  return {
    referenceSet: reference.name,
    positives: positives.length,
    negatives: negatives.length,
    auroc: auroc(positives, negatives),
    averagePrecision: averagePrecision(positives, negatives),
    roc: rocCurve(positives, negatives),
  }
}

/**
 * Leave-one-term-out ablation.
 *
 * The honest way to report a composite score: if dropping a term does not move AUROC,
 * that term is not earning its place in the model, and the paper should say so.
 */
export function ablate(
  gathered: GatheredEvidence,
  config: TrustConfig,
  reference: ReferenceSet,
): AblationRow[] {
  // Must score *with identity*: reference sets are usually keyed by gene symbol, and
  // a bare TrustScore carries none, so matching would silently find nothing.
  const full = calibrate(scoreWithIdentity(gathered, config), reference).auroc
  const rows: AblationRow[] = [{ removed: null, auroc: full, delta: 0 }]

  for (const term of TRUST_TERMS) {
    if (config.weights[term] === 0) continue
    const reduced: TrustConfig = {
      ...config,
      name: `${config.name}-without-${term}`,
      weights: { ...config.weights, [term]: 0 },
    }
    const value = calibrate(scoreWithIdentity(gathered, reduced), reference).auroc
    rows.push({ removed: term, auroc: value, delta: value - full })
  }
  return rows
}

/**
 * Parse a user-supplied reference set.
 *
 * Accepts two columns of gene symbols per line, comma- or tab-separated, with an
 * optional label column of `+`/`-` marking positives and negatives. Lines beginning
 * with `#` are comments.
 */
export function parseReferenceSet(name: string, text: string): ReferenceSet {
  const positives = new Set<string>()
  const negatives = new Set<string>()

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const fields = line.split(/[,\t]/).map((f) => f.trim())
    const a = fields[0]
    const b = fields[1]
    if (!a || !b) continue

    const label = fields[2]
    const target = label === '-' ? negatives : positives
    target.add(`${a.toUpperCase()}|${b.toUpperCase()}`)
    target.add(`${b.toUpperCase()}|${a.toUpperCase()}`)
  }

  return negatives.size > 0
    ? { name, positives, negatives }
    : { name, positives }
}
