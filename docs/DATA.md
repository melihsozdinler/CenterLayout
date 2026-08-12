# Data model

Everything ProLiVis loads goes into an in-browser DuckDB database, persisted in the
browser's Origin Private File System. It is a real database and you can query it
directly with `prolivis.sql(...)`.

## Where the data comes from

BioGRID's **tab3** format (bulk downloads) and **tab2** (what the REST API returns).
Columns are resolved by alias onto one canonical set, because the two formats disagree:
tab3 writes `Experimental System`, `Author`, `Publication Source`, `Throughput` and
`Score`; tab2 writes `Pubmed ID`, `Organism Interactor A` and `Phenotypes`. A reader
hard-coded to one vocabulary could serve files or the API, never both.

Columns a producer does not supply resolve to `NULL` rather than failing the load, and
the ingest result reports which — so a REST-loaded dataset says up front that it has no
UniProt accessions, ontology terms or organism names.

## Three things about BioGRID worth knowing

**`Publication Source` is not always a PubMed id.** About a fifth of records in release
5.0.260 are DOI-referenced. Publications are keyed `pubmed:<id>` or `doi:<id>`
accordingly; a reader that assumes PubMed drops those records silently.

**`Throughput` is a set, not a scalar.** A record can be tagged
`High Throughput|Low Throughput` when a publication reports an interaction both in a
screen and in a targeted follow-up. It is stored as two independent booleans.

**Gene symbols are not unique across organisms.** In the coronavirus set alone, 18
symbols map to more than one gene — `E`, `M`, `N` and `S` exist in three coronavirus
species. Nodes are therefore keyed by **BioGRID gene id**, never by symbol. Keying by
symbol would fuse the SARS-CoV-2 nucleocapsid with the SARS-CoV one into a single node
with a fabricated interaction profile.

## Tables

### `interactions`

One row per BioGRID record: an assertion by one publication, using one experimental
system, that two genes interact. An interaction between two proteins is therefore many
rows — which is exactly what the trust model reasons over.

All 37 tab3 columns, plus these derived at ingest:

| Column | Meaning |
| --- | --- |
| `node_lo`, `node_hi` | The pair's BioGRID gene ids, canonically ordered |
| `pair_key` | `'<lo>~<hi>'`, for grouping |
| `publication_key` | `pubmed:<id>` \| `doi:<id>` \| `other:<raw>` |
| `author_name` | `Dalton S`, split from BioGRID's `Dalton S (1997)` |
| `publication_year` | `1997`, likewise |
| `throughput_low`, `throughput_high` | Independent booleans |
| `score_num` | `Score` as a number, or NULL where it was not numeric |
| `is_self_interaction`, `is_inter_species` | |

The original `symbol_a`/`symbol_b` keep their recorded roles — for directional assays,
A is the bait — while `node_lo`/`node_hi` give the canonical undirected pair.

### `ppi_pairs` (view)

One row per undirected interaction, with its evidence aggregated: `record_count`,
`publication_count`, `system_count`, `author_count`, the `systems` and `publications`
lists, `has_physical` / `has_genetic`, low- and high-throughput record counts,
`first_year` / `last_year`, `max_score`.

### `genes`, `publications`

Dictionaries derived from the interaction rows, keyed by `(dataset_id, biogrid_id)` and
`(dataset_id, publication_key)`.

### `literature`

Enrichment from OpenAlex and PubMed: title, venue, year, `citation_count`,
`is_open_access`, `first_author`, `institution_rors`, `institution_names`.

Keyed by **publication alone, not by dataset**. The same paper recurs across organisms,
releases and queries, and its citation count does not depend on which BioGRID file was
loaded — so enrichment is paid for once and survives reloads, re-queries and
comparisons. A publication nobody could resolve is recorded with `found = FALSE`, so a
second run does not re-ask the same questions.

`citation_count` is `NULL`, never `0`, when unknown.

### `datasets`

Provenance: label, source kind (`file` or `rest`), source detail (filename or query),
BioGRID release, load time, record count. This is what makes a comparison meaningful
and a session manifest reproducible.

## Scale

DuckDB does all parsing, coercion, derivation and aggregation. TypeScript generates the
SQL and never iterates over interaction rows — a full release is ~3M records, and an
object-per-row representation would spend more time in the garbage collector than in
the work.

Zip members are inflated in line-aligned chunks with the reader throttled, so peak
memory is one chunk regardless of archive size. A plain `.txt` is registered as a file
handle and read lazily, so it never enters memory at all.

Measured against the full `BIOGRID-ALL-5.0.260` release — 181 MB zipped, 1.55 GB
uncompressed, **2,916,237 records** — ingest takes **78 seconds**, after which the
organism list returns in 0.7 s and the experimental-system breakdown in 0.4 s. The
coronavirus set (76,632 records) takes 12 s.

Peak memory is not reported here: `performance.memory` is quantised or stubbed in the
headless browser used for the benchmark, and its figures were not credible enough to
publish.
