import { describe, expect, it } from 'vitest'
import {
  EXPERIMENTAL_SYSTEMS,
  evidenceClassesOf,
  isKnownExperimentalSystem,
  lookupExperimentalSystem,
} from '@/data/vocabulary'

/** Every experimental system observed in BIOGRID-CORONAVIRUS-5.0.260. */
const OBSERVED_IN_REAL_DATA = [
  'Affinity Capture-Luminescence',
  'Affinity Capture-MS',
  'Affinity Capture-RNA',
  'Affinity Capture-Western',
  'Biochemical Activity',
  'Co-crystal Structure',
  'Co-fractionation',
  'Co-localization',
  'Co-purification',
  'Cross-Linking-MS (XL-MS)',
  'Dosage Rescue',
  'FRET',
  'Far Western',
  'PCA',
  'Protein-RNA',
  'Protein-peptide',
  'Proximity Label-MS',
  'Reconstituted Complex',
  'Surface Display',
  'Synthetic Lethality',
  'Two-hybrid',
]

describe('experimental system vocabulary', () => {
  it('covers every system seen in a current BioGRID release', () => {
    const missing = OBSERVED_IN_REAL_DATA.filter((n) => !isKnownExperimentalSystem(n))
    expect(missing).toEqual([])
  })

  it('has unique names and directness values in [0, 1]', () => {
    const names = EXPERIMENTAL_SYSTEMS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    for (const s of EXPERIMENTAL_SYSTEMS) {
      expect(s.directness).toBeGreaterThanOrEqual(0)
      expect(s.directness).toBeLessThanOrEqual(1)
    }
  })

  it('scores genetic systems as zero evidence of physical interaction', () => {
    const genetic = EXPERIMENTAL_SYSTEMS.filter((s) => s.type === 'genetic')
    expect(genetic.length).toBeGreaterThan(0)
    for (const s of genetic) {
      expect(s.directness).toBe(0)
      expect(s.evidenceClass).toBe('genetic')
    }
  })

  it('ranks structural evidence above co-complex above co-localization', () => {
    const d = (n: string) => lookupExperimentalSystem(n).directness
    expect(d('Co-crystal Structure')).toBeGreaterThan(d('Affinity Capture-MS'))
    expect(d('Affinity Capture-MS')).toBeGreaterThan(d('Co-localization'))
    expect(d('Two-hybrid')).toBeGreaterThan(d('Proximity Label-MS'))
  })

  it('is case- and whitespace-insensitive on lookup', () => {
    expect(lookupExperimentalSystem('  two-hybrid ').name).toBe('Two-hybrid')
  })

  it('gives an unknown physical assay a cautious default rather than a high prior', () => {
    const unknown = lookupExperimentalSystem('Some Future Assay-MS', 'physical')
    expect(unknown.type).toBe('physical')
    expect(unknown.directness).toBeLessThan(
      lookupExperimentalSystem('Affinity Capture-Western').directness,
    )
    expect(isKnownExperimentalSystem('Some Future Assay-MS')).toBe(false)
  })

  it('respects a declared genetic type for an unknown assay', () => {
    expect(lookupExperimentalSystem('New Genetic Assay', 'genetic').directness).toBe(0)
  })
})

describe('evidenceClassesOf', () => {
  it('collapses assays that share a failure mode into one class', () => {
    const classes = evidenceClassesOf([
      'Affinity Capture-MS',
      'Affinity Capture-Western',
      'Co-purification',
    ])
    expect([...classes]).toEqual(['co-complex'])
  })

  it('separates orthogonal assays into distinct classes', () => {
    const classes = evidenceClassesOf([
      'Two-hybrid',
      'Affinity Capture-MS',
      'Co-crystal Structure',
    ])
    expect([...classes].sort()).toEqual(['binary', 'co-complex', 'structural'])
  })
})
