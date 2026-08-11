/**
 * The citation-trust model: types, weights and presets.
 *
 * The question this answers is not "does BioGRID list this interaction" — it always
 * does — but "how much should I believe it". BioGRID records evidence without
 * weighing it, so a pair asserted once by a single high-throughput screen and a pair
 * confirmed by twenty labs across a dozen assays are indistinguishable in the file.
 *
 * Seven terms, each in [0, 1], each reported separately so a reader can see *why* a
 * pair scored what it did, and each re-weightable so a project can disagree with our
 * defaults in the open rather than by forking the code.
 */

export const TRUST_TERMS = [
  'replication',
  'independence',
  'methodDiversity',
  'methodWeight',
  'throughput',
  'literatureImpact',
  'currency',
] as const

export type TrustTerm = (typeof TRUST_TERMS)[number]

export interface TermDescription {
  readonly term: TrustTerm
  readonly label: string
  /** What the term measures. */
  readonly measures: string
  /** Why it belongs in a confidence score. */
  readonly rationale: string
  /** Whether the term needs literature enrichment to be informed. */
  readonly needsEnrichment: boolean
}

export const TERM_DESCRIPTIONS: readonly TermDescription[] = [
  {
    term: 'replication',
    label: 'Replication',
    measures: 'How many distinct publications report the interaction.',
    rationale: 'One paper is a claim; several independent reports are a finding.',
    needsEnrichment: false,
  },
  {
    term: 'independence',
    label: 'Independence',
    measures:
      'How many distinct research groups those publications come from, clustered by shared institutions.',
    rationale:
      'Five papers from one laboratory are one group reporting five times, not five independent confirmations. Replication alone cannot see this.',
    needsEnrichment: true,
  },
  {
    term: 'methodDiversity',
    label: 'Method diversity',
    measures:
      'How many distinct classes of experimental evidence support it — binary, co-complex, structural, proximity, enzymatic.',
    rationale:
      'Two affinity-capture experiments share their failure modes. An assay from a different class fails differently, so spanning classes is much stronger than repeating one.',
    needsEnrichment: false,
  },
  {
    term: 'methodWeight',
    label: 'Method directness',
    measures: 'How directly the strongest supporting assay demonstrates a contact.',
    rationale:
      'A co-crystal structure shows two proteins touching. Co-fractionation shows they elute together. These are not the same claim.',
    needsEnrichment: false,
  },
  {
    term: 'throughput',
    label: 'Throughput',
    measures: 'The share of supporting records from low-throughput experiments.',
    rationale:
      'A hit in a genome-wide screen is a hypothesis; a targeted experiment is a test of one.',
    needsEnrichment: false,
  },
  {
    term: 'literatureImpact',
    label: 'Literature impact',
    measures:
      'How well-cited the supporting publications are, relative to the rest of the corpus and to their age.',
    rationale:
      'An interaction whose only support is a paper nobody has cited in twenty years is weaker than one resting on a landmark. Age-normalised and rank-based, so recent work is not punished for being recent.',
    needsEnrichment: true,
  },
  {
    term: 'currency',
    label: 'Currency',
    measures: 'How recently the interaction was last reported.',
    rationale:
      'Flags claims made once, long ago, and never revisited — not because old results are wrong, but because they are unexamined.',
    needsEnrichment: false,
  },
]

/** Tuning constants. Exposed so the paper can state them and users can change them. */
export interface TrustConstants {
  /** Saturation of the replication term; larger means more papers are needed. */
  readonly replicationScale: number
  /** Saturation of the independence term over lab clusters. */
  readonly independenceScale: number
  /** Saturation of the method-diversity term over evidence classes. */
  readonly diversityScale: number
  /**
   * Credit given to an extra assay within a class already counted, relative to a
   * whole new class. Below 1 because same-class assays share failure modes.
   */
  readonly sameClassCredit: number
  /** Half-life, in years, of the currency term. */
  readonly currencyHalfLifeYears: number
  /** Year treated as "now" when computing currency and citation rates. */
  readonly referenceYear: number
}

export const DEFAULT_CONSTANTS: TrustConstants = {
  replicationScale: 1.5,
  independenceScale: 1.2,
  diversityScale: 1.0,
  sameClassCredit: 0.3,
  currencyHalfLifeYears: 25,
  referenceYear: new Date().getUTCFullYear(),
}

export type TrustWeights = Readonly<Record<TrustTerm, number>>

export interface TrustConfig {
  readonly name: string
  readonly description: string
  readonly weights: TrustWeights
  readonly constants: TrustConstants
}

const w = (partial: Partial<TrustWeights>): TrustWeights => ({
  replication: 0,
  independence: 0,
  methodDiversity: 0,
  methodWeight: 0,
  throughput: 0,
  literatureImpact: 0,
  currency: 0,
  ...partial,
})

/**
 * Shipped presets.
 *
 * The weights are a documented default, not a discovered optimum. `calibrate.ts`
 * measures how well each ranks reference-set positives above negatives, so a project
 * can check them against its own gold standard rather than taking them on faith.
 */
export const PRESETS: Readonly<Record<string, TrustConfig>> = {
  'literature-aware': {
    name: 'literature-aware',
    description:
      'Default. Weighs BioGRID evidence together with how independent and how well-cited the supporting literature is. Needs enrichment for its full effect.',
    weights: w({
      replication: 0.22,
      independence: 0.18,
      methodDiversity: 0.2,
      methodWeight: 0.15,
      throughput: 0.08,
      literatureImpact: 0.12,
      currency: 0.05,
    }),
    constants: DEFAULT_CONSTANTS,
  },
  'evidence-only': {
    name: 'evidence-only',
    description:
      'Uses nothing but the BioGRID record. Fully offline and free of any judgement about the literature; the honest choice when enrichment is unavailable or unwanted.',
    weights: w({
      replication: 0.35,
      independence: 0.15,
      methodDiversity: 0.28,
      methodWeight: 0.15,
      throughput: 0.07,
    }),
    constants: DEFAULT_CONSTANTS,
  },
  'structural-strict': {
    name: 'structural-strict',
    description:
      'For work that needs direct physical contact. Dominated by assay directness, so co-fractionation and proximity labelling cannot carry a pair on their own.',
    weights: w({
      methodWeight: 0.4,
      methodDiversity: 0.2,
      replication: 0.15,
      independence: 0.15,
      throughput: 0.1,
    }),
    constants: DEFAULT_CONSTANTS,
  },
}

export const DEFAULT_PRESET = 'literature-aware'

export function getPreset(name: string): TrustConfig {
  const preset = PRESETS[name]
  if (!preset) {
    throw new Error(
      `Unknown trust preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}.`,
    )
  }
  return preset
}

/** Weights normalized to sum to 1, so a hand-edited config still behaves. */
export function normalizeWeights(weights: TrustWeights): TrustWeights {
  const total = TRUST_TERMS.reduce((sum, t) => sum + Math.max(0, weights[t]), 0)
  if (total <= 0) {
    throw new Error('Trust weights must include at least one positive term')
  }
  const out = {} as Record<TrustTerm, number>
  for (const t of TRUST_TERMS) out[t] = Math.max(0, weights[t]) / total
  return out
}

/** Whether a config asks for terms that only literature enrichment can inform. */
export function requiresEnrichment(config: TrustConfig): boolean {
  return TERM_DESCRIPTIONS.some(
    (d) => d.needsEnrichment && config.weights[d.term] > 0,
  )
}
