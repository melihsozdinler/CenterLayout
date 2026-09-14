/**
 * The trust terms themselves: pure functions from evidence to a number in [0, 1].
 *
 * Every term is written so that "we do not know" returns `null` rather than a value.
 * A term that returns null is dropped from the weighted mean and the remaining
 * weights are renormalized, so an un-enriched dataset yields a score computed from
 * what is actually known instead of one silently dragged toward the middle by
 * missing inputs. Unknown is not average.
 */

import { evidenceClassesOf, lookupExperimentalSystem } from '../data/vocabulary'
import type { TrustConstants, TrustTerm, TrustWeights } from './model'
import { TRUST_TERMS } from './model'

/** Evidence for one protein pair, as gathered from the database. */
export interface PairEvidence {
  readonly pairKey: string
  /** Distinct experimental system names supporting the pair. */
  readonly systems: readonly string[]
  /** One entry per distinct supporting publication. */
  readonly publications: readonly PublicationEvidence[]
  /** Supporting records tagged low throughput. */
  readonly lowThroughputRecords: number
  /** Supporting records tagged high throughput. */
  readonly highThroughputRecords: number
  readonly hasPhysical: boolean
  readonly hasGenetic: boolean
}

export interface PublicationEvidence {
  readonly publicationKey: string
  /** BioGRID's first-author label, e.g. `Dalton S`. */
  readonly authorName: string | null
  readonly year: number | null
  /** ROR ids of contributing institutions; empty when unresolved. */
  readonly institutionRors: readonly string[]
  /** Citations, or null when the publication could not be resolved. */
  readonly citationCount: number | null
}

/** Saturating growth: 0 at `count = 1`, approaching 1 as evidence accumulates. */
export function saturate(count: number, scale: number): number {
  if (count <= 1) return 0
  return 1 - Math.exp(-(count - 1) / scale)
}

// --- 1. Replication ---------------------------------------------------------

export function replicationTerm(
  evidence: PairEvidence,
  constants: TrustConstants,
): number {
  return saturate(evidence.publications.length, constants.replicationScale)
}

// --- 2. Independence --------------------------------------------------------

/**
 * Cluster publications into research groups.
 *
 * Two publications are treated as the same group when their contributing
 * institutions overlap; groups are the connected components of that relation, found
 * by union-find. Publications with no resolved institution fall back to their BioGRID
 * first-author label, which is a weaker but non-empty signal.
 *
 * This is the term that makes the model more than an evidence count: a pair reported
 * five times by one laboratory should not outrank one reported twice by two.
 */
export function clusterLabs(
  publications: readonly PublicationEvidence[],
): PublicationEvidence[][] {
  const n = publications.length
  if (n === 0) return []

  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]!
    // Path compression, so repeated lookups stay near-constant.
    let cursor = i
    while (parent[cursor] !== root) {
      const next = parent[cursor]!
      parent[cursor] = root
      cursor = next
    }
    return root
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  // Link publications that share an institution, or that lack institutions but share
  // a first author.
  const byRor = new Map<string, number>()
  const byAuthor = new Map<string, number>()

  publications.forEach((pub, i) => {
    if (pub.institutionRors.length > 0) {
      for (const ror of pub.institutionRors) {
        const seen = byRor.get(ror)
        if (seen === undefined) byRor.set(ror, i)
        else union(seen, i)
      }
    } else if (pub.authorName) {
      const key = pub.authorName.toLowerCase()
      const seen = byAuthor.get(key)
      if (seen === undefined) byAuthor.set(key, i)
      else union(seen, i)
    }
  })

  const groups = new Map<number, PublicationEvidence[]>()
  publications.forEach((pub, i) => {
    const root = find(i)
    const existing = groups.get(root)
    if (existing) existing.push(pub)
    else groups.set(root, [pub])
  })
  return [...groups.values()]
}

/**
 * Independence is informed only when we know where the publications came from.
 * Returning null for a wholly unresolved pair keeps the term out of the mean rather
 * than asserting that one paper means one lab.
 */
export function independenceTerm(
  evidence: PairEvidence,
  constants: TrustConstants,
): number | null {
  const resolvable = evidence.publications.some(
    (p) => p.institutionRors.length > 0 || p.authorName !== null,
  )
  if (!resolvable) return null
  return saturate(clusterLabs(evidence.publications).length, constants.independenceScale)
}

// --- 3. Method diversity ----------------------------------------------------

/**
 * Diversity counts *classes* of evidence, not assay names. An extra assay inside a
 * class already counted earns partial credit, because it shares that class's failure
 * modes: two affinity-capture experiments can both be fooled by the same sticky bait.
 */
export function methodDiversityTerm(
  evidence: PairEvidence,
  constants: TrustConstants,
): number {
  const systemCount = new Set(evidence.systems).size
  if (systemCount === 0) return 0
  const classCount = evidenceClassesOf(evidence.systems).size
  const effective =
    classCount - 1 + constants.sameClassCredit * Math.max(0, systemCount - classCount)
  return effective <= 0 ? 0 : 1 - Math.exp(-effective / constants.diversityScale)
}

// --- 4. Method directness ---------------------------------------------------

/** The strongest claim any supporting assay makes about a physical contact. */
export function methodWeightTerm(evidence: PairEvidence): number {
  let best = 0
  for (const system of evidence.systems) {
    const directness = lookupExperimentalSystem(system).directness
    if (directness > best) best = directness
  }
  return best
}

// --- 5. Throughput ----------------------------------------------------------

/**
 * The share of supporting records that came from low-throughput work. A pair
 * supported only by screens scores 0 here — not because screens are worthless, but
 * because this term is precisely the question "has anyone tested this directly".
 */
export function throughputTerm(evidence: PairEvidence): number | null {
  const total = evidence.lowThroughputRecords + evidence.highThroughputRecords
  if (total === 0) return null
  return evidence.lowThroughputRecords / total
}

// --- 6. Literature impact ---------------------------------------------------

/**
 * Citations per year since publication, log-compressed.
 *
 * Rate rather than raw count, so a 2023 paper is not punished for having had less
 * time to accumulate citations; log-compressed because the difference between 10 and
 * 100 citations matters far more than between 1000 and 1090.
 */
export function citationRate(
  publication: PublicationEvidence,
  constants: TrustConstants,
): number | null {
  if (publication.citationCount === null) return null
  const year = publication.year ?? constants.referenceYear
  const age = Math.max(1, constants.referenceYear - year + 1)
  return Math.log1p(publication.citationCount / age)
}

/**
 * Impact is expressed relative to the corpus, via a normalizer built from every
 * publication in the dataset (see `buildImpactNormalizer`). An absolute citation
 * threshold would mean something different in every field.
 */
export function literatureImpactTerm(
  evidence: PairEvidence,
  constants: TrustConstants,
  normalize: (rate: number) => number,
): number | null {
  const rates = evidence.publications
    .map((p) => citationRate(p, constants))
    .filter((r): r is number => r !== null)
  if (rates.length === 0) return null
  // The best-supported publication defines the pair's standing: one landmark paper
  // is not diluted by the routine papers that also mention the interaction.
  return normalize(Math.max(...rates))
}

/**
 * Build a percentile normalizer from the corpus's citation rates.
 *
 * Rank-based rather than parametric: citation distributions are heavy-tailed, and a
 * mean-and-variance normalization would let a handful of landmark papers compress
 * everything else into indistinguishability.
 */
export function buildImpactNormalizer(rates: readonly number[]): (rate: number) => number {
  const sorted = [...rates].filter((r) => Number.isFinite(r)).sort((a, b) => a - b)
  if (sorted.length === 0) return () => 0.5
  if (sorted.length === 1) return () => 0.5

  return (rate: number) => {
    // Fraction of the corpus this rate is at least as large as.
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! <= rate) lo = mid + 1
      else hi = mid
    }
    return lo / sorted.length
  }
}

// --- 7. Currency ------------------------------------------------------------

/** Exponential decay from the most recent supporting publication. */
export function currencyTerm(
  evidence: PairEvidence,
  constants: TrustConstants,
): number | null {
  const years = evidence.publications
    .map((p) => p.year)
    .filter((y): y is number => y !== null)
  if (years.length === 0) return null
  const age = Math.max(0, constants.referenceYear - Math.max(...years))
  return Math.pow(0.5, age / constants.currencyHalfLifeYears)
}

// --- Combination ------------------------------------------------------------

export type TermValues = Readonly<Record<TrustTerm, number | null>>

export interface TrustScore {
  readonly pairKey: string
  /** Combined confidence in [0, 1]. */
  readonly score: number
  /** Per-term values; null where the input was unknown. */
  readonly terms: TermValues
  /** Share of the configured weight that was actually informed, in [0, 1]. */
  readonly coverage: number
  /**
   * `genetic` pairs have no physical evidence at all. They are scored like anything
   * else — method directness is zero for genetic assays, so they score low — but the
   * flag lets a view exclude or separate them rather than silently mixing claims
   * about function with claims about contact.
   */
  readonly evidenceType: 'physical' | 'genetic' | 'mixed'
}

export interface ScoringContext {
  readonly constants: TrustConstants
  readonly weights: TrustWeights
  readonly normalizeImpact: (rate: number) => number
}

/** Compute every term for one pair. */
export function computeTerms(
  evidence: PairEvidence,
  context: ScoringContext,
): TermValues {
  const { constants } = context
  return {
    replication: replicationTerm(evidence, constants),
    independence: independenceTerm(evidence, constants),
    methodDiversity: methodDiversityTerm(evidence, constants),
    methodWeight: methodWeightTerm(evidence),
    throughput: throughputTerm(evidence),
    literatureImpact: literatureImpactTerm(
      evidence,
      constants,
      context.normalizeImpact,
    ),
    currency: currencyTerm(evidence, constants),
  }
}

/**
 * Combine terms into one score.
 *
 * A weighted mean over the *informed* terms, with the weights of unknown terms
 * redistributed. `coverage` reports how much of the configured weight was informed,
 * so a score computed from half the model can be recognized as such.
 */
export function combineTerms(terms: TermValues, weights: TrustWeights): {
  score: number
  coverage: number
} {
  let weighted = 0
  let informedWeight = 0
  let totalWeight = 0

  for (const term of TRUST_TERMS) {
    const weight = Math.max(0, weights[term])
    totalWeight += weight
    const value = terms[term]
    if (weight === 0 || value === null) continue
    weighted += weight * value
    informedWeight += weight
  }

  if (informedWeight === 0) return { score: 0, coverage: 0 }
  return {
    score: weighted / informedWeight,
    coverage: totalWeight === 0 ? 0 : informedWeight / totalWeight,
  }
}

/** Score one pair end to end. */
export function scorePair(
  evidence: PairEvidence,
  context: ScoringContext,
): TrustScore {
  const terms = computeTerms(evidence, context)
  const { score, coverage } = combineTerms(terms, context.weights)
  const evidenceType: TrustScore['evidenceType'] =
    evidence.hasPhysical && evidence.hasGenetic
      ? 'mixed'
      : evidence.hasGenetic
        ? 'genetic'
        : 'physical'

  return { pairKey: evidence.pairKey, score, terms, coverage, evidenceType }
}
