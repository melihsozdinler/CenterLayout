import { describe, expect, it } from 'vitest'
import {
  ablate,
  auroc,
  averagePrecision,
  calibrate,
  parseReferenceSet,
  referenceKeys,
  rocCurve,
} from '@/trust/calibrate'
import { DEFAULT_CONSTANTS, PRESETS, type TrustConfig } from '@/trust/model'
import type { ScoredPair } from '@/trust/score'
import type { GatheredEvidence } from '@/trust/score'
import type { PairEvidence } from '@/trust/terms'

describe('auroc', () => {
  it('is 1 for perfect separation and 0 for perfectly inverted separation', () => {
    expect(auroc([0.9, 0.8, 0.7], [0.3, 0.2, 0.1])).toBe(1)
    expect(auroc([0.1, 0.2], [0.8, 0.9])).toBe(0)
  })

  it('is 0.5 for a scorer that cannot separate at all', () => {
    // Every pair scored identically must measure as chance, not as perfect.
    expect(auroc([0.5, 0.5, 0.5], [0.5, 0.5])).toBe(0.5)
  })

  it('credits ties a half, as the rank-sum definition requires', () => {
    // One positive above, one tied, so 0.5 + 0.5*0.5 over two comparisons.
    expect(auroc([0.9, 0.5], [0.5])).toBeCloseTo(0.75, 12)
  })

  it('is undefined when a class is empty', () => {
    expect(auroc([], [0.5])).toBeNaN()
    expect(auroc([0.5], [])).toBeNaN()
  })
})

describe('averagePrecision', () => {
  it('is 1 when every positive outranks every negative', () => {
    expect(averagePrecision([0.9, 0.8], [0.2, 0.1])).toBeCloseTo(1, 12)
  })

  it('penalises negatives that outrank positives', () => {
    expect(averagePrecision([0.4], [0.9, 0.8])).toBeLessThan(0.5)
  })
})

describe('rocCurve', () => {
  it('starts at the origin and ends at (1, 1)', () => {
    const curve = rocCurve([0.9, 0.6], [0.7, 0.2])
    expect(curve[0]).toMatchObject({ falsePositiveRate: 0, truePositiveRate: 0 })
    const last = curve[curve.length - 1]!
    expect(last.falsePositiveRate).toBeCloseTo(1, 12)
    expect(last.truePositiveRate).toBeCloseTo(1, 12)
  })

  it('is monotonically non-decreasing in both coordinates', () => {
    const curve = rocCurve([0.9, 0.7, 0.5], [0.8, 0.4, 0.1])
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.falsePositiveRate).toBeGreaterThanOrEqual(
        curve[i - 1]!.falsePositiveRate,
      )
      expect(curve[i]!.truePositiveRate).toBeGreaterThanOrEqual(
        curve[i - 1]!.truePositiveRate,
      )
    }
  })
})

function scored(pairKey: string, score: number, symbols?: [string, string]): ScoredPair {
  return {
    pairKey,
    score,
    coverage: 1,
    evidenceType: 'physical',
    terms: {
      replication: score,
      independence: null,
      methodDiversity: score,
      methodWeight: score,
      throughput: null,
      literatureImpact: null,
      currency: null,
    },
    nodeLo: 1,
    nodeHi: 2,
    symbolLo: symbols?.[0] ?? null,
    symbolHi: symbols?.[1] ?? null,
  }
}

describe('referenceKeys', () => {
  it('matches on the pair key or on gene symbols in either order', () => {
    const keys = referenceKeys(scored('1~2', 0.5, ['mdm2', 'TP53']))
    expect(keys).toContain('1~2')
    expect(keys).toContain('MDM2|TP53')
    expect(keys).toContain('TP53|MDM2')
  })
})

describe('calibrate', () => {
  it('separates a reference set by score', () => {
    const pairs = [
      scored('a', 0.9, ['A', 'B']),
      scored('b', 0.8, ['C', 'D']),
      scored('c', 0.2, ['E', 'F']),
      scored('d', 0.1, ['G', 'H']),
    ]
    const result = calibrate(pairs, {
      name: 'toy',
      positives: new Set(['A|B', 'C|D']),
      negatives: new Set(['E|F', 'G|H']),
    })

    expect(result.positives).toBe(2)
    expect(result.negatives).toBe(2)
    expect(result.auroc).toBe(1)
  })

  it('treats unlabelled pairs as negatives when no negative set is supplied', () => {
    const pairs = [scored('a', 0.9, ['A', 'B']), scored('b', 0.1, ['C', 'D'])]
    const result = calibrate(pairs, { name: 'toy', positives: new Set(['A|B']) })
    expect(result.positives).toBe(1)
    expect(result.negatives).toBe(1)
  })
})

describe('parseReferenceSet', () => {
  it('reads symbol pairs from a tab- or comma-separated file', () => {
    const set = parseReferenceSet('toy', 'MDM2\tTP53\nRPL5,RPL11\n')
    expect(set.positives.has('MDM2|TP53')).toBe(true)
    expect(set.positives.has('TP53|MDM2')).toBe(true)
    expect(set.positives.has('RPL5|RPL11')).toBe(true)
  })

  it('reads an optional third column marking negatives', () => {
    const set = parseReferenceSet('toy', 'A,B,+\nC,D,-\n')
    expect(set.positives.has('A|B')).toBe(true)
    expect(set.negatives?.has('C|D')).toBe(true)
    expect(set.positives.has('C|D')).toBe(false)
  })

  it('ignores comments and blank lines', () => {
    const set = parseReferenceSet('toy', '# a comment\n\nA,B\n')
    expect(set.positives.size).toBe(2)
  })

  it('upper-cases symbols so case differences do not silently miss', () => {
    const set = parseReferenceSet('toy', 'mdm2,tp53\n')
    expect(set.positives.has('MDM2|TP53')).toBe(true)
  })
})

describe('ablate', () => {
  /**
   * A toy dataset where publication *count* is identical everywhere and only the
   * number of distinct laboratories differs: positives come from three separate
   * institutions, negatives are one laboratory publishing three times.
   *
   * This is precisely the case a plain evidence count cannot see, so it isolates the
   * independence term — the model's novel claim — from replication.
   */
  function toyEvidence(): GatheredEvidence {
    const make = (key: string, rors: string[]): PairEvidence => ({
      pairKey: key,
      systems: ['Two-hybrid'],
      publications: rors.map((ror, i) => ({
        publicationKey: `pubmed:${key}${i}`,
        authorName: `Author ${key}${i}`,
        year: 2015,
        institutionRors: [ror],
        citationCount: null,
      })),
      lowThroughputRecords: rors.length,
      highThroughputRecords: 0,
      hasPhysical: true,
      hasGenetic: false,
    })

    const evidence: PairEvidence[] = [
      // Three publications, three different laboratories.
      make('P1', ['ror-a', 'ror-b', 'ror-c']),
      make('P2', ['ror-d', 'ror-e', 'ror-f']),
      // Three publications, all from the same laboratory.
      make('N1', ['ror-x', 'ror-x', 'ror-x']),
      make('N2', ['ror-y', 'ror-y', 'ror-y']),
    ]
    const identities = new Map(
      evidence.map((e) => [
        e.pairKey,
        { pairKey: e.pairKey, nodeLo: 1, nodeHi: 2, symbolLo: e.pairKey, symbolHi: 'X' },
      ]),
    )
    return { evidence, identities, corpusRates: [] }
  }

  const config: TrustConfig = {
    ...PRESETS['evidence-only']!,
    constants: { ...DEFAULT_CONSTANTS, referenceYear: 2026 },
  }

  const reference = {
    name: 'toy',
    positives: new Set(['P1|X', 'P2|X']),
    negatives: new Set(['N1|X', 'N2|X']),
  }

  it('reports the full model first, with zero delta', () => {
    const rows = ablate(toyEvidence(), config, reference)
    expect(rows[0]!.removed).toBeNull()
    expect(rows[0]!.delta).toBe(0)
    expect(rows[0]!.auroc).toBe(1)
  })

  it('shows a drop when the term carrying the signal is removed', () => {
    const rows = ablate(toyEvidence(), config, reference)
    const withoutIndependence = rows.find((r) => r.removed === 'independence')!
    // Independence is the only term that separates these pairs; without it the model
    // cannot tell three laboratories from one laboratory publishing three times.
    expect(withoutIndependence.delta).toBeLessThan(0)
    expect(withoutIndependence.auroc).toBeCloseTo(0.5, 12)
  })

  it('shows no drop for terms that carry no signal in this data', () => {
    const rows = ablate(toyEvidence(), config, reference)
    // Every pair has three publications and one assay type, so neither replication
    // nor directness can discriminate here.
    expect(rows.find((r) => r.removed === 'replication')!.delta).toBe(0)
    expect(rows.find((r) => r.removed === 'methodWeight')!.delta).toBe(0)
  })

  it('skips terms the configuration already zeroes out', () => {
    const rows = ablate(toyEvidence(), config, reference)
    expect(rows.some((r) => r.removed === 'literatureImpact')).toBe(false)
  })
})
