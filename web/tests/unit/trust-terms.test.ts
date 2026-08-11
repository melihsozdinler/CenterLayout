import { describe, expect, it } from 'vitest'
import { DEFAULT_CONSTANTS, normalizeWeights, PRESETS, TRUST_TERMS } from '@/trust/model'
import {
  buildImpactNormalizer,
  citationRate,
  clusterLabs,
  combineTerms,
  currencyTerm,
  independenceTerm,
  methodDiversityTerm,
  methodWeightTerm,
  replicationTerm,
  saturate,
  scorePair,
  throughputTerm,
  type PairEvidence,
  type PublicationEvidence,
  type ScoringContext,
  type TermValues,
} from '@/trust/terms'

const C = { ...DEFAULT_CONSTANTS, referenceYear: 2026 }

function pub(overrides: Partial<PublicationEvidence> = {}): PublicationEvidence {
  return {
    publicationKey: `pubmed:${Math.random().toString().slice(2, 10)}`,
    authorName: 'Someone A',
    year: 2020,
    institutionRors: [],
    citationCount: null,
    ...overrides,
  }
}

function evidence(overrides: Partial<PairEvidence> = {}): PairEvidence {
  return {
    pairKey: '1~2',
    systems: ['Two-hybrid'],
    publications: [pub()],
    lowThroughputRecords: 1,
    highThroughputRecords: 0,
    hasPhysical: true,
    hasGenetic: false,
    ...overrides,
  }
}

describe('saturate', () => {
  it('is zero for a single observation and approaches, never exceeds, 1', () => {
    expect(saturate(0, 1.5)).toBe(0)
    expect(saturate(1, 1.5)).toBe(0)
    expect(saturate(2, 1.5)).toBeGreaterThan(0)
    expect(saturate(10, 1.5)).toBeLessThan(1)
    // Asymptotic in exact arithmetic; at ~100 observations it reaches 1 in float64,
    // which is the right behaviour — such a pair is at the ceiling of the term.
    expect(saturate(100, 1.5)).toBeLessThanOrEqual(1)
  })

  it('is monotonic in the count', () => {
    let previous = -1
    for (let n = 1; n <= 30; n += 1) {
      const value = saturate(n, 1.5)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('replicationTerm', () => {
  it('gives a single-publication pair no credit at all', () => {
    expect(replicationTerm(evidence({ publications: [pub()] }), C)).toBe(0)
  })

  it('rewards additional publications with diminishing returns', () => {
    const two = replicationTerm(evidence({ publications: [pub(), pub()] }), C)
    const three = replicationTerm(evidence({ publications: [pub(), pub(), pub()] }), C)
    const ten = replicationTerm(
      evidence({ publications: Array.from({ length: 10 }, () => pub()) }),
      C,
    )
    expect(two).toBeGreaterThan(0)
    expect(three).toBeGreaterThan(two)
    expect(ten).toBeGreaterThan(three)
    // Diminishing: the second paper matters more than the tenth.
    expect(two - 0).toBeGreaterThan(ten - three)
  })
})

describe('clusterLabs', () => {
  it('treats publications sharing an institution as one group', () => {
    const groups = clusterLabs([
      pub({ institutionRors: ['00hj8s172'] }),
      pub({ institutionRors: ['00hj8s172'] }),
      pub({ institutionRors: ['00892tw58'] }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.length).sort()).toEqual([1, 2])
  })

  it('links groups transitively through a shared collaborator institution', () => {
    // A-B and B-C share institutions, so all three are one collaboration network.
    const groups = clusterLabs([
      pub({ institutionRors: ['A', 'B'] }),
      pub({ institutionRors: ['B', 'C'] }),
      pub({ institutionRors: ['C'] }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('falls back to the first-author label when institutions are unresolved', () => {
    const groups = clusterLabs([
      pub({ institutionRors: [], authorName: 'Gavin AC' }),
      pub({ institutionRors: [], authorName: 'Gavin AC' }),
      pub({ institutionRors: [], authorName: 'Krogan NJ' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('returns no groups for no publications', () => {
    expect(clusterLabs([])).toEqual([])
  })
})

describe('independenceTerm', () => {
  it('separates five papers from one lab from five papers from five labs', () => {
    const oneLab = evidence({
      publications: Array.from({ length: 5 }, () => pub({ institutionRors: ['same'] })),
    })
    const fiveLabs = evidence({
      publications: Array.from({ length: 5 }, (_, i) =>
        pub({ institutionRors: [`lab${i}`] }),
      ),
    })

    // Replication cannot tell these apart; that is exactly why independence exists.
    expect(replicationTerm(oneLab, C)).toBeCloseTo(replicationTerm(fiveLabs, C), 12)
    expect(independenceTerm(oneLab, C)).toBe(0)
    expect(independenceTerm(fiveLabs, C)!).toBeGreaterThan(0.9)
  })

  it('is unknown, not zero, when nothing about provenance is resolvable', () => {
    const unresolved = evidence({
      publications: [pub({ institutionRors: [], authorName: null })],
    })
    expect(independenceTerm(unresolved, C)).toBeNull()
  })
})

describe('methodDiversityTerm', () => {
  it('gives one assay no diversity credit', () => {
    expect(methodDiversityTerm(evidence({ systems: ['Two-hybrid'] }), C)).toBe(0)
  })

  it('rewards spanning evidence classes far more than repeating one', () => {
    const sameClass = methodDiversityTerm(
      evidence({
        systems: ['Affinity Capture-MS', 'Affinity Capture-Western', 'Co-purification'],
      }),
      C,
    )
    const acrossClasses = methodDiversityTerm(
      evidence({ systems: ['Affinity Capture-MS', 'Two-hybrid'] }),
      C,
    )
    // Three co-complex assays share their failure modes; two orthogonal ones do not.
    expect(acrossClasses).toBeGreaterThan(sameClass)
  })

  it('still gives partial credit for extra assays within a class', () => {
    const one = methodDiversityTerm(evidence({ systems: ['Affinity Capture-MS'] }), C)
    const two = methodDiversityTerm(
      evidence({ systems: ['Affinity Capture-MS', 'Co-purification'] }),
      C,
    )
    expect(two).toBeGreaterThan(one)
  })
})

describe('methodWeightTerm', () => {
  it('takes the strongest supporting assay', () => {
    const value = methodWeightTerm(
      evidence({ systems: ['Co-localization', 'Co-crystal Structure'] }),
    )
    expect(value).toBe(1.0)
  })

  it('scores genetic-only evidence as no evidence of physical contact', () => {
    expect(methodWeightTerm(evidence({ systems: ['Synthetic Lethality'] }))).toBe(0)
  })

  it('ranks proximity labelling below a targeted binary assay', () => {
    expect(methodWeightTerm(evidence({ systems: ['Proximity Label-MS'] }))).toBeLessThan(
      methodWeightTerm(evidence({ systems: ['Two-hybrid'] })),
    )
  })
})

describe('throughputTerm', () => {
  it('is the low-throughput share of supporting records', () => {
    expect(
      throughputTerm(evidence({ lowThroughputRecords: 3, highThroughputRecords: 1 })),
    ).toBe(0.75)
    expect(
      throughputTerm(evidence({ lowThroughputRecords: 0, highThroughputRecords: 5 })),
    ).toBe(0)
  })

  it('is unknown when no record carries a throughput tag', () => {
    expect(
      throughputTerm(evidence({ lowThroughputRecords: 0, highThroughputRecords: 0 })),
    ).toBeNull()
  })
})

describe('citationRate and the impact normalizer', () => {
  it('normalizes by age so recent work is not punished for being recent', () => {
    const old = citationRate(pub({ year: 1996, citationCount: 100 }), C)!
    const recent = citationRate(pub({ year: 2024, citationCount: 100 }), C)!
    expect(recent).toBeGreaterThan(old)
  })

  it('is unknown when the publication could not be resolved', () => {
    expect(citationRate(pub({ citationCount: null }), C)).toBeNull()
  })

  it('ranks against the corpus rather than an absolute threshold', () => {
    const normalize = buildImpactNormalizer([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(normalize(-1)).toBe(0)
    expect(normalize(9)).toBe(1)
    expect(normalize(4)).toBeCloseTo(0.5, 1)
  })

  it('stays neutral rather than confident when the corpus is too small to rank', () => {
    expect(buildImpactNormalizer([])(5)).toBe(0.5)
    expect(buildImpactNormalizer([3])(5)).toBe(0.5)
  })
})

describe('currencyTerm', () => {
  it('decays with the age of the most recent supporting publication', () => {
    const fresh = currencyTerm(evidence({ publications: [pub({ year: 2026 })] }), C)!
    const stale = currencyTerm(evidence({ publications: [pub({ year: 1996 })] }), C)!
    expect(fresh).toBeCloseTo(1, 6)
    // A 30-year-old sole report, at a 25-year half-life.
    expect(stale).toBeLessThan(0.5)
  })

  it('uses the most recent publication, not the oldest', () => {
    const value = currencyTerm(
      evidence({ publications: [pub({ year: 1996 }), pub({ year: 2025 })] }),
      C,
    )!
    expect(value).toBeGreaterThan(0.9)
  })

  it('is unknown when no publication has a year', () => {
    expect(currencyTerm(evidence({ publications: [pub({ year: null })] }), C)).toBeNull()
  })
})

describe('combineTerms', () => {
  const weights = normalizeWeights(PRESETS['literature-aware']!.weights)

  it('renormalizes over the informed terms so unknown is not treated as average', () => {
    const allKnown: TermValues = {
      replication: 1,
      independence: 1,
      methodDiversity: 1,
      methodWeight: 1,
      throughput: 1,
      literatureImpact: 1,
      currency: 1,
    }
    const someUnknown: TermValues = { ...allKnown, independence: null, literatureImpact: null }

    // Both are "everything we know is maximal", so both must score 1 — the second
    // just with lower coverage.
    expect(combineTerms(allKnown, weights).score).toBeCloseTo(1, 12)
    expect(combineTerms(someUnknown, weights).score).toBeCloseTo(1, 12)
    expect(combineTerms(someUnknown, weights).coverage).toBeLessThan(1)
    expect(combineTerms(allKnown, weights).coverage).toBeCloseTo(1, 12)
  })

  it('reports zero coverage and no score when nothing is known', () => {
    const nothing = Object.fromEntries(
      TRUST_TERMS.map((t) => [t, null]),
    ) as unknown as TermValues
    expect(combineTerms(nothing, weights)).toEqual({ score: 0, coverage: 0 })
  })

  it('keeps the score inside [0, 1]', () => {
    const half = Object.fromEntries(
      TRUST_TERMS.map((t) => [t, 0.5]),
    ) as unknown as TermValues
    const { score } = combineTerms(half, weights)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
    expect(score).toBeCloseTo(0.5, 12)
  })
})

describe('scorePair', () => {
  const context: ScoringContext = {
    constants: C,
    weights: normalizeWeights(PRESETS['literature-aware']!.weights),
    normalizeImpact: buildImpactNormalizer([0, 1, 2, 3, 4]),
  }

  it('ranks a well-supported interaction above a single high-throughput hit', () => {
    const wellSupported = scorePair(
      evidence({
        systems: ['Co-crystal Structure', 'Two-hybrid', 'Affinity Capture-MS'],
        publications: [
          pub({ institutionRors: ['a'], citationCount: 500, year: 2015 }),
          pub({ institutionRors: ['b'], citationCount: 300, year: 2018 }),
          pub({ institutionRors: ['c'], citationCount: 120, year: 2022 }),
        ],
        lowThroughputRecords: 6,
        highThroughputRecords: 1,
      }),
      context,
    )
    const screenHit = scorePair(
      evidence({
        systems: ['Proximity Label-MS'],
        publications: [pub({ institutionRors: ['z'], citationCount: 2, year: 2019 })],
        lowThroughputRecords: 0,
        highThroughputRecords: 1,
      }),
      context,
    )

    expect(wellSupported.score).toBeGreaterThan(screenHit.score)
    expect(wellSupported.score).toBeGreaterThan(0.6)
    expect(screenHit.score).toBeLessThan(0.3)
  })

  it('flags genetic-only evidence rather than presenting it as physical', () => {
    const genetic = scorePair(
      evidence({
        systems: ['Synthetic Lethality'],
        hasPhysical: false,
        hasGenetic: true,
      }),
      context,
    )
    expect(genetic.evidenceType).toBe('genetic')
    // Directness is zero for genetic assays, so it cannot score as a strong contact.
    expect(genetic.terms.methodWeight).toBe(0)
  })

  it('labels a pair with both kinds of evidence as mixed', () => {
    const mixed = scorePair(
      evidence({
        systems: ['Two-hybrid', 'Synthetic Lethality'],
        hasPhysical: true,
        hasGenetic: true,
      }),
      context,
    )
    expect(mixed.evidenceType).toBe('mixed')
  })

  it('exposes every term so a score can be explained, not just asserted', () => {
    const scored = scorePair(evidence(), context)
    expect(Object.keys(scored.terms).sort()).toEqual([...TRUST_TERMS].sort())
  })
})

describe('presets', () => {
  it('normalize to weights summing to one', () => {
    for (const preset of Object.values(PRESETS)) {
      const normalized = normalizeWeights(preset.weights)
      const sum = TRUST_TERMS.reduce((s, t) => s + normalized[t], 0)
      expect(sum).toBeCloseTo(1, 12)
    }
  })

  it('evidence-only uses nothing that requires enrichment', () => {
    const offline = PRESETS['evidence-only']!
    expect(offline.weights.literatureImpact).toBe(0)
  })

  it('structural-strict is dominated by assay directness', () => {
    const strict = normalizeWeights(PRESETS['structural-strict']!.weights)
    for (const term of TRUST_TERMS) {
      if (term === 'methodWeight') continue
      expect(strict.methodWeight).toBeGreaterThan(strict[term])
    }
  })

  it('rejects a configuration with no positive weight', () => {
    const empty = Object.fromEntries(TRUST_TERMS.map((t) => [t, 0]))
    expect(() => normalizeWeights(empty as never)).toThrow(/at least one/)
  })
})
