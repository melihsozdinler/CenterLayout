/**
 * BioGRID experimental-system vocabulary, annotated with the two properties the trust
 * model needs and BioGRID itself does not provide: what *kind* of evidence the assay
 * produces, and how directly it demonstrates a physical contact.
 *
 * ProLiVis 1.0 carried the bare name lists in `biogriddefinition.h` but never used
 * them. Here they become weights.
 *
 * The `evidenceClass` grouping is the basis of the trust model's method-diversity
 * term: two assays in the *same* class share failure modes (two affinity-capture
 * experiments both report indirect co-complex membership), while assays in different
 * classes fail independently, so spanning classes is much stronger evidence than
 * repeating one.
 */

export type ExperimentalSystemType = 'physical' | 'genetic'

export type EvidenceClass =
  /** Direct binary contact between two purified or reconstituted partners. */
  | 'binary'
  /** Co-membership of a complex; does not imply direct contact. */
  | 'co-complex'
  /** Atomic-resolution structural evidence. */
  | 'structural'
  /** Spatial nearness in vivo, without demonstrating contact. */
  | 'proximity'
  /** One protein acts enzymatically on another. */
  | 'enzymatic'
  /** Shared localization only; the weakest physical claim. */
  | 'colocalization'
  /** Genetic interaction; not evidence of a physical interaction at all. */
  | 'genetic'

export interface ExperimentalSystem {
  readonly name: string
  readonly type: ExperimentalSystemType
  readonly evidenceClass: EvidenceClass
  /**
   * Prior confidence that a single record of this assay reflects a real, direct
   * physical interaction, in [0, 1]. Ordering follows the standard reading of assay
   * directness; the absolute values are a documented default, overridable per-project
   * in the trust configuration.
   */
  readonly directness: number
  readonly definition: string
}

const SYSTEMS: readonly ExperimentalSystem[] = [
  // --- Physical: structural ------------------------------------------------
  {
    name: 'Co-crystal Structure',
    type: 'physical',
    evidenceClass: 'structural',
    directness: 1.0,
    definition:
      'Interaction directly demonstrated at the atomic level by X-ray crystallography.',
  },
  // --- Physical: binary ----------------------------------------------------
  {
    name: 'Reconstituted Complex',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.85,
    definition: 'Interaction inferred between purified proteins in vitro, e.g. GST pull-down.',
  },
  {
    name: 'Two-hybrid',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.75,
    definition:
      'Bait and prey expressed as DNA-binding and activation-domain fusions, scored by reporter activation.',
  },
  {
    name: 'PCA',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.75,
    definition:
      'Protein-fragment complementation assay: complementary reporter fragments refold when partners associate.',
  },
  {
    name: 'Far Western',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.7,
    definition: 'Immobilized bait probed with prey, which localizes to the same position.',
  },
  {
    name: 'Protein-peptide',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.7,
    definition: 'Interaction between a protein and a peptide, e.g. by phage display.',
  },
  {
    name: 'Surface Display',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.65,
    definition:
      'Protein fused to a surface protein and assayed by yeast, phage or bacterial display.',
  },
  {
    name: 'Protein-RNA',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.7,
    definition: 'Interaction between a protein and an RNA detected in vitro.',
  },
  // --- Physical: enzymatic -------------------------------------------------
  {
    name: 'Biochemical Activity',
    type: 'physical',
    evidenceClass: 'enzymatic',
    directness: 0.8,
    definition:
      'Biochemical effect of one protein upon another in vitro, such as phosphorylation.',
  },
  // --- Physical: proximity -------------------------------------------------
  {
    name: 'FRET',
    type: 'physical',
    evidenceClass: 'proximity',
    directness: 0.7,
    definition:
      'Close proximity of partners detected by fluorescence resonance energy transfer.',
  },
  {
    name: 'Cross-Linking-MS (XL-MS)',
    type: 'physical',
    evidenceClass: 'proximity',
    directness: 0.7,
    definition:
      'Chemically reactive reagents covalently link proximal residues, followed by mass spectrometry.',
  },
  {
    name: 'Proximity Label-MS',
    type: 'physical',
    evidenceClass: 'proximity',
    directness: 0.45,
    definition:
      'A bait-enzyme fusion labels vicinal proteins, which are then identified by mass spectrometry.',
  },
  {
    name: 'Thermal Shift Assay',
    type: 'physical',
    evidenceClass: 'binary',
    directness: 0.6,
    definition: 'Interaction demonstrated by a change in thermal stability upon binding.',
  },
  // --- Physical: co-complex ------------------------------------------------
  {
    name: 'Affinity Capture-Western',
    type: 'physical',
    evidenceClass: 'co-complex',
    directness: 0.6,
    definition:
      'Bait captured and partner detected by Western blot with a specific antibody or epitope tag.',
  },
  {
    name: 'Affinity Capture-Luminescence',
    type: 'physical',
    evidenceClass: 'co-complex',
    directness: 0.55,
    definition: 'Luciferase-tagged bait enzymatically detected in immunoprecipitates.',
  },
  {
    name: 'Affinity Capture-MS',
    type: 'physical',
    evidenceClass: 'co-complex',
    directness: 0.5,
    definition:
      'Bait captured and partners identified by mass spectrometry; does not imply direct contact.',
  },
  {
    name: 'Affinity Capture-RNA',
    type: 'physical',
    evidenceClass: 'co-complex',
    directness: 0.5,
    definition: 'Bait affinity-captured and the associated RNA identified in vivo.',
  },
  {
    name: 'Co-purification',
    type: 'physical',
    evidenceClass: 'co-complex',
    directness: 0.5,
    definition: 'Two or more subunits identified in a purified protein complex.',
  },
  {
    name: 'Co-fractionation',
    type: 'physical',
    evidenceClass: 'co-complex',
    directness: 0.35,
    definition: 'Two or more subunits present in a partially purified preparation.',
  },
  // --- Physical: colocalization -------------------------------------------
  {
    name: 'Co-localization',
    type: 'physical',
    evidenceClass: 'colocalization',
    directness: 0.2,
    definition:
      'Proteins co-localize in the cell, or one mislocalizes when the other is deleted.',
  },
  // --- Genetic --------------------------------------------------------------
  ...(
    [
      ['Dosage Growth Defect', 'Increased dosage of one gene causes a growth defect in a strain mutated for another.'],
      ['Dosage Lethality', 'Increased dosage of one gene causes lethality in a strain mutated for another.'],
      ['Dosage Rescue', 'Increased dosage of one gene rescues lethality or a growth defect of another.'],
      ['Negative Genetic', 'Combined mutations give a more severe fitness defect than expected.'],
      ['Positive Genetic', 'Combined mutations give a less severe fitness defect than expected.'],
      ['Phenotypic Enhancement', 'One mutation enhances a phenotype associated with another.'],
      ['Phenotypic Suppression', 'One mutation suppresses a phenotype associated with another.'],
      ['Synthetic Growth Defect', 'Combined mutations in one cell give a significant growth defect.'],
      ['Synthetic Haploinsufficiency', 'Mutations in separate genes, at least one hemizygous, are lethal in combination.'],
      ['Synthetic Lethality', 'Mutations or deletions in separate genes are lethal in combination.'],
      ['Synthetic Rescue', 'Mutation or deletion of one gene rescues lethality or a growth defect of another.'],
    ] as const
  ).map(
    ([name, definition]): ExperimentalSystem => ({
      name,
      type: 'genetic',
      evidenceClass: 'genetic',
      // Genetic interactions are evidence of a functional relationship, not of a
      // physical contact. They are scored on their own axis and contribute nothing
      // to physical-interaction confidence.
      directness: 0.0,
      definition,
    }),
  ),
]

const BY_NAME: ReadonlyMap<string, ExperimentalSystem> = new Map(
  SYSTEMS.map((s) => [s.name.toLowerCase(), s]),
)

export const EXPERIMENTAL_SYSTEMS = SYSTEMS

/**
 * Look up an experimental system by its BioGRID name.
 *
 * BioGRID adds assays between releases, so an unknown name is expected rather than
 * exceptional. Unknown physical assays fall back to a deliberately mid-low prior so a
 * new high-throughput method cannot silently inflate trust scores before we have
 * classified it.
 */
export function lookupExperimentalSystem(
  name: string | null | undefined,
  declaredType?: string | null,
): ExperimentalSystem {
  const known = name ? BY_NAME.get(name.trim().toLowerCase()) : undefined
  if (known) return known

  const type: ExperimentalSystemType =
    declaredType?.trim().toLowerCase() === 'genetic' ? 'genetic' : 'physical'
  return {
    name: name?.trim() || 'Unknown',
    type,
    evidenceClass: type === 'genetic' ? 'genetic' : 'co-complex',
    directness: type === 'genetic' ? 0.0 : 0.4,
    definition: 'Not present in the bundled BioGRID vocabulary; scored with a default prior.',
  }
}

export function isKnownExperimentalSystem(name: string): boolean {
  return BY_NAME.has(name.trim().toLowerCase())
}

/** Distinct evidence classes covered by a set of experimental-system names. */
export function evidenceClassesOf(names: Iterable<string>): Set<EvidenceClass> {
  const classes = new Set<EvidenceClass>()
  for (const n of names) classes.add(lookupExperimentalSystem(n).evidenceClass)
  return classes
}
