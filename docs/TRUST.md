# The citation-trust model

BioGRID records evidence without weighing it. A protein pair asserted once by a single
high-throughput screen and a pair confirmed by twenty laboratories across a dozen assays
are the same kind of row in the same file. This model scores that difference.

It is a **documented default, not a discovered optimum**. Every term is reported
separately, every weight is editable, and [`calibrate`](#calibration) measures how well
a configuration ranks a reference set you supply. Disagree with it in the open.

---

## The seven terms

Each term is a number in `[0, 1]`, or `null` when its input is unknown.

### 1. Replication — *how many distinct publications report it*

```
replication = 1 − exp(−(|P| − 1) / κ_p)          κ_p = 1.5
```

Zero for a single publication: one paper is a claim, not a finding. Saturating, so the
second paper matters far more than the tenth.

### 2. Independence — *how many distinct research groups those publications come from*

Publications are clustered into groups by **union-find over shared institution
identifiers** (RORs, from OpenAlex). Two publications sharing an institution are the
same group; groups are the connected components of that relation. Publications with no
resolved institution fall back to BioGRID's own first-author label.

```
independence = 1 − exp(−(|L| − 1) / κ_l)         κ_l = 1.2
```

**This is the term that makes the model more than an evidence count.** Five papers from
one laboratory are one group reporting five times, not five independent confirmations,
and `replication` cannot tell the difference — it scores both identically. Returns
`null` when nothing about provenance is resolvable, rather than asserting that one
paper means one lab.

### 3. Method diversity — *how many distinct classes of evidence support it*

Counts **classes**, not assay names:

| Class | Assays | Fails when |
| --- | --- | --- |
| `structural` | Co-crystal Structure | — |
| `binary` | Two-hybrid, PCA, Reconstituted Complex, Far Western, Protein-peptide, Surface Display, Thermal Shift | the fusion or the in-vitro condition misleads |
| `co-complex` | Affinity Capture-MS/Western/RNA/Luminescence, Co-purification, Co-fractionation | the bait is sticky, or the partners never touch |
| `proximity` | FRET, Cross-Linking-MS, Proximity Label-MS | proteins are near but not bound |
| `enzymatic` | Biochemical Activity | — |
| `colocalization` | Co-localization | proteins share a compartment only |
| `genetic` | all genetic systems | not evidence of physical contact at all |

```
diversity = 1 − exp(−((|C| − 1) + 0.3·(|S| − |C|)) / κ_d)    κ_d = 1.0
```

Two affinity-capture experiments share their failure modes; an assay from another class
fails differently. Spanning classes is therefore much stronger evidence than repeating
one, and same-class repeats earn only partial credit.

### 4. Method directness — *how directly the strongest assay shows a contact*

The maximum, over the supporting assays, of a per-assay prior:

| | |
| --- | --- |
| 1.00 | Co-crystal Structure |
| 0.85 | Reconstituted Complex |
| 0.80 | Biochemical Activity |
| 0.75 | Two-hybrid, PCA |
| 0.70 | FRET, Cross-Linking-MS, Far Western, Protein-peptide, Protein-RNA |
| 0.60 | Affinity Capture-Western, Thermal Shift |
| 0.50 | Affinity Capture-MS, Affinity Capture-RNA, Co-purification |
| 0.45 | Proximity Label-MS |
| 0.35 | Co-fractionation |
| 0.20 | Co-localization |
| 0.00 | every genetic system |

A co-crystal structure shows two proteins touching. Co-fractionation shows they elute
together. These are not the same claim. Genetic systems score zero because a genetic
interaction is evidence of a functional relationship, not of a physical contact — such
pairs are also flagged `evidenceType: 'genetic'` so a view can separate them rather
than silently mixing the two kinds of claim.

An assay absent from the bundled vocabulary gets a deliberately cautious 0.4, so a new
high-throughput method cannot inflate scores before it has been classified.

### 5. Throughput — *the low-throughput share of the supporting records*

```
throughput = low_records / (low_records + high_records)
```

A hit in a genome-wide screen is a hypothesis; a targeted experiment is a test of one.
`null` when no record carries a throughput tag.

### 6. Literature impact — *how well-cited the supporting publications are*

```
rate  = log(1 + citations / years_since_publication)
value = percentile of the best supporting publication's rate, within this dataset
```

A *rate*, so recent work is not punished for having had less time to accumulate
citations. Log-compressed, because the difference between 10 and 100 citations matters
far more than between 1000 and 1090. A *percentile within the corpus*, because a
citation count that marks a landmark in structural biology is unremarkable in cancer
genomics. The *best* supporting publication, so one landmark paper is not diluted by the
routine papers that also mention the interaction.

`null` when no supporting publication could be resolved. **Never zero** — scoring our
own ignorance as absence of impact would systematically penalise older and less-indexed
literature.

### 7. Currency — *how recently it was last reported*

```
currency = 0.5 ^ (years_since_most_recent_report / 25)
```

Not because old results are wrong, but because unexamined ones deserve flagging.

---

## Combining them

A weighted mean **over the informed terms only**, with the weights of unknown terms
redistributed across the rest:

```
score    = Σ(wᵢ · termᵢ) / Σ(wᵢ)     over terms where termᵢ ≠ null
coverage = Σ(wᵢ) / Σ(all weights)
```

**Unknown is not average.** A dataset with no literature enrichment yields a score
computed from what is genuinely known, not one dragged toward the middle by missing
inputs. `coverage` reports how much of the model was informed, and every export carries
it: a score of 0.6 at 40% coverage is a different claim from the same score at full
coverage, and the file says so.

---

## Presets

| Preset | Replication | Independence | Diversity | Directness | Throughput | Impact | Currency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `literature-aware` (default) | 0.22 | 0.18 | 0.20 | 0.15 | 0.08 | 0.12 | 0.05 |
| `evidence-only` | 0.35 | 0.15 | 0.28 | 0.15 | 0.07 | — | — |
| `structural-strict` | 0.15 | 0.15 | 0.20 | **0.40** | 0.10 | — | — |

- **`literature-aware`** weighs BioGRID evidence together with how independent and how
  well-cited the supporting literature is. Needs enrichment for its full effect.
- **`evidence-only`** uses nothing but the BioGRID record. Fully offline and free of
  any judgement about the literature — the honest choice when enrichment is
  unavailable or unwanted.
- **`structural-strict`** is for work that needs direct physical contact. Over the
  34,540 SARS-CoV-2 interactions in release 5.0.260 it correlates with the assay
  directness term at **0.512**, against `evidence-only`'s 0.302 and
  `literature-aware`'s 0.325 — so the preset does what its name claims rather than
  being decorative, while remaining a combination of seven terms rather than a proxy
  for directness alone.

Weights are editable in the interface and in the API. They are normalized to sum to
one, so a hand-edited configuration still behaves.

---

## Calibration

```js
const gathered  = await prolivis.gather({ datasetId })
const reference = prolivis.referenceSet('CORUM', await file.text())
const result    = prolivis.calibrate(prolivis.rescore(gathered), reference)
const ablation  = prolivis.ablate(gathered, reference)
```

`calibrate` reports AUROC, average precision and the ROC curve. `ablate` removes each
weighted term in turn and reports the change in AUROC — the honest way to present a
composite score, because a term that moves nothing is not earning its place, and the
paper should say so.

Reference sets are two columns of gene symbols per line, comma- or tab-separated, with
an optional third column of `+` or `-`:

```
# CORUM co-complex pairs
MDM2,TP53,+
RPL5,RPL11,+
MDM2,ACTB,-
```

**No gold standard is bundled.** Shipping one would invite scoring the model on the
same data everyone tunes it against. Candidates worth using: CORUM complexes, hu.MAP
co-complex pairs, or the positive and negative reference sets from the interaction
benchmarking literature.

One caveat: symbol-keyed reference sets are ambiguous in cross-species data, because
distinct organisms reuse gene symbols. Calibrate one organism at a time, or key the
reference set by BioGRID pair key.

---

## Things this model does not do

- **It does not know about sequence, structure or function.** It scores the *evidence*,
  not the biology. A well-replicated artefact scores highly, and should — the problem
  is with the literature, and the score is reporting it faithfully.
- **It does not predict interactions.** Every pair it scores is one BioGRID already
  lists. It ranks them; it never adds one.
- **It cannot see co-citation bias.** If a field converges on believing something, the
  literature terms will agree with the field.
- **Institution clustering is a proxy for laboratory identity, not a measurement of
  it.** Two unrelated groups at the same large university are merged; a group that
  moved institutions is split. It is better than counting papers, and it is not truth.
