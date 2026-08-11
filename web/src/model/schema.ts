/**
 * Database schema and ingest SQL.
 *
 * Design note: the browser never iterates over interaction rows in JavaScript. A full
 * BIOGRID-ALL release is ~3M records, so all parsing, type coercion, derivation and
 * aggregation happens inside DuckDB. TypeScript's job is to define the schema and
 * generate the SQL; the pure helpers in `data/tab3.ts` mirror the same semantics for
 * the small number of places (REST responses, tests) that do handle single rows.
 */

import { CANONICAL_COLUMNS, type CanonicalColumn, type ResolvedHeader } from '../data/columns'

/** Bump when a migration is needed; the engine drops and rebuilds on mismatch. */
export const SCHEMA_VERSION = 2

/** Separator inside the canonical unordered-pair key. */
export const PAIR_KEY_SEPARATOR = '~'

export const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key    VARCHAR PRIMARY KEY,
     value  VARCHAR NOT NULL
   )`,

  /* One row per loaded dataset. Provenance lives here so that any figure, export or
     comparison can name exactly where its numbers came from. */
  `CREATE TABLE IF NOT EXISTS datasets (
     dataset_id        VARCHAR PRIMARY KEY,
     label             VARCHAR NOT NULL,
     source_kind       VARCHAR NOT NULL,   -- 'file' | 'rest'
     source_detail     VARCHAR,            -- filename, or the REST query string
     biogrid_release   VARCHAR,            -- e.g. '5.0.260', parsed from the filename
     loaded_at         TIMESTAMP NOT NULL,
     record_count      BIGINT NOT NULL DEFAULT 0,
     notes             VARCHAR
   )`,

  /* One row per BioGRID record: an assertion by one publication, using one
     experimental system, that two genes interact. An interaction between two proteins
     is therefore many rows, which is precisely what the trust model reasons over. */
  `CREATE TABLE IF NOT EXISTS interactions (
     dataset_id                  VARCHAR NOT NULL,
     biogrid_interaction_id      BIGINT,

     -- interactor A as recorded (bait, for directional assays)
     entrez_a                    VARCHAR,
     biogrid_id_a                BIGINT,
     systematic_a                VARCHAR,
     symbol_a                    VARCHAR,
     synonyms_a                  VARCHAR,
     organism_id_a               INTEGER,
     organism_name_a             VARCHAR,
     swissprot_a                 VARCHAR,
     trembl_a                    VARCHAR,
     refseq_a                    VARCHAR,

     -- interactor B as recorded (prey)
     entrez_b                    VARCHAR,
     biogrid_id_b                BIGINT,
     systematic_b                VARCHAR,
     symbol_b                    VARCHAR,
     synonyms_b                  VARCHAR,
     organism_id_b               INTEGER,
     organism_name_b             VARCHAR,
     swissprot_b                 VARCHAR,
     trembl_b                    VARCHAR,
     refseq_b                    VARCHAR,

     -- evidence
     experimental_system         VARCHAR,
     experimental_system_type    VARCHAR,
     author                      VARCHAR,
     publication_source          VARCHAR,
     throughput                  VARCHAR,
     score                       VARCHAR,
     modification                VARCHAR,
     qualifications              VARCHAR,
     tags                        VARCHAR,
     source_database             VARCHAR,

     -- ontology annotations
     ontology_term_ids           VARCHAR,
     ontology_term_names         VARCHAR,
     ontology_term_categories    VARCHAR,
     ontology_term_qualifier_ids VARCHAR,
     ontology_term_qualifier_names VARCHAR,
     ontology_term_types         VARCHAR,

     -- derived at ingest, never in the source file
     node_lo                     BIGINT,   -- canonical unordered pair, low id
     node_hi                     BIGINT,   -- canonical unordered pair, high id
     pair_key                    VARCHAR,  -- '<lo>~<hi>', for grouping in JS
     publication_key             VARCHAR,  -- 'pubmed:<id>' | 'doi:<id>' | 'other:<raw>'
     author_name                 VARCHAR,  -- 'Dalton S'
     publication_year            INTEGER,  -- 1997
     throughput_low              BOOLEAN,
     throughput_high             BOOLEAN,
     score_num                   DOUBLE,
     is_self_interaction         BOOLEAN,
     is_inter_species            BOOLEAN
   )`,

  /* Gene dictionary, derived from the interaction rows. BioGRID's own gene id is the
     node identity: gene symbols are NOT unique across organisms, and a cross-species
     dataset (e.g. the coronavirus set, which mixes SARS-CoV-2 with human) would
     silently merge unrelated genes if keyed by symbol. */
  `CREATE TABLE IF NOT EXISTS genes (
     dataset_id     VARCHAR NOT NULL,
     biogrid_id     BIGINT  NOT NULL,
     symbol         VARCHAR,
     systematic     VARCHAR,
     entrez         VARCHAR,
     synonyms       VARCHAR,
     organism_id    INTEGER,
     organism_name  VARCHAR,
     swissprot      VARCHAR,
     PRIMARY KEY (dataset_id, biogrid_id)
   )`,

  /* Publication dictionary, per dataset: who reported what, and how much. */
  `CREATE TABLE IF NOT EXISTS publications (
     dataset_id       VARCHAR NOT NULL,
     publication_key  VARCHAR NOT NULL,
     ref_kind         VARCHAR,        -- 'pubmed' | 'doi' | 'other'
     ref_id           VARCHAR,
     author_label     VARCHAR,        -- 'Dalton S (1997)', the ProLiVis 1.0 node label
     author_name      VARCHAR,
     year             INTEGER,
     record_count     BIGINT,
     pair_count       BIGINT,
     system_count     BIGINT,
     PRIMARY KEY (dataset_id, publication_key)
   )`,

  /* Literature metadata fetched from OpenAlex and PubMed.

     Deliberately keyed by publication alone, *not* by dataset: the same paper appears
     across organisms, releases and queries, and its citation count does not depend on
     which BioGRID file you happened to load. A dataset-independent cache means
     enrichment is paid for once and survives reloading, re-querying and comparison. */
  `CREATE TABLE IF NOT EXISTS literature (
     publication_key   VARCHAR PRIMARY KEY,
     provider          VARCHAR,       -- 'openalex' | 'pubmed'
     openalex_id       VARCHAR,
     doi               VARCHAR,
     pmid              VARCHAR,
     title             VARCHAR,
     venue             VARCHAR,
     year              INTEGER,
     citation_count    BIGINT,        -- NULL means unknown; never assume zero
     is_open_access    BOOLEAN,
     work_type         VARCHAR,
     first_author      VARCHAR,
     author_count      INTEGER,
     institution_rors  VARCHAR,       -- pipe-joined ROR ids
     institution_names VARCHAR,       -- pipe-joined display names
     fetched_at        TIMESTAMP NOT NULL,
     found             BOOLEAN NOT NULL DEFAULT TRUE
   )`,
]

/** Indexes created after bulk load, so ingest itself stays fast. */
export const INDEXES: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_int_dataset ON interactions (dataset_id)',
  'CREATE INDEX IF NOT EXISTS idx_int_pair ON interactions (dataset_id, pair_key)',
  'CREATE INDEX IF NOT EXISTS idx_int_pub ON interactions (dataset_id, publication_key)',
  'CREATE INDEX IF NOT EXISTS idx_int_system ON interactions (dataset_id, experimental_system)',
  'CREATE INDEX IF NOT EXISTS idx_genes_symbol ON genes (dataset_id, symbol)',
  'CREATE INDEX IF NOT EXISTS idx_pub_dataset ON publications (dataset_id)',
]

/** Escape a string literal for inlining into SQL. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Escape an identifier (column or table name) for inlining into SQL. */
export function sqlIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Build the `read_csv` call for a registered tab3 file.
 *
 * Everything is read as VARCHAR and cast in the projection. That costs a little speed
 * but means a release that appends a column, or a REST response that omits the `#`
 * prefix, still loads instead of failing on a type sniff.
 */
export function readCsvExpr(fileName: string): string {
  return (
    `read_csv(${sqlString(fileName)}, ` +
    `delim='\\t', ` +
    `header=true, ` +
    `quote='', ` + // tab3 has no CSV quoting; a stray " must not swallow the line
    `escape='', ` +
    `nullstr='-', ` + // BioGRID's null sentinel
    `all_varchar=true, ` +
    `ignore_errors=false)`
  )
}

/**
 * Resolve a tab3 column to a SQL expression.
 *
 * The lookup is by canonical name but the emitted identifier is the *literal* spelling
 * from the file, because bulk dumps write `#BioGRID Interaction ID` and the REST API
 * writes it without the `#`. Returns `NULL` for columns a producer omitted, so a
 * partial file still loads with the missing fields empty.
 */
function col(header: ResolvedHeader, canonical: CanonicalColumn): string {
  const position = header.index.get(canonical)
  if (position === undefined) return 'NULL'
  const literal = header.names[position]
  return literal === undefined ? 'NULL' : sqlIdent(literal)
}

/**
 * The projection that turns raw tab3 strings into the `interactions` schema, including
 * every derived column. Mirrors the semantics of the pure helpers in `data/tab3.ts`.
 */
export function buildInteractionSelect(
  header: ResolvedHeader,
  datasetId: string,
  fileName: string,
): string {
  const c = (name: CanonicalColumn) => col(header, name)

  const pubSource = c('Publication Source')
  const authorCol = c('Author')
  const throughputCol = c('Throughput')
  const idA = c('BioGRID ID Interactor A')
  const idB = c('BioGRID ID Interactor B')

  // Prefix before the first ':' decides how a publication is keyed. BioGRID emits
  // PUBMED: for most records and DOI: for a substantial minority (~20% in 5.0.260).
  const publicationKey = `
    CASE
      WHEN ${pubSource} IS NULL THEN NULL
      WHEN upper(regexp_extract(${pubSource}, '^([^:]+):', 1)) = 'PUBMED'
        THEN 'pubmed:' || trim(regexp_replace(${pubSource}, '^[^:]+:', ''))
      WHEN upper(regexp_extract(${pubSource}, '^([^:]+):', 1)) = 'DOI'
        THEN 'doi:' || lower(trim(regexp_replace(${pubSource}, '^[^:]+:', '')))
      WHEN regexp_full_match(${pubSource}, '[0-9]+')
        THEN 'pubmed:' || ${pubSource}
      ELSE 'other:' || ${pubSource}
    END`

  const nodeA = `TRY_CAST(${idA} AS BIGINT)`
  const nodeB = `TRY_CAST(${idB} AS BIGINT)`

  return `
    SELECT
      ${sqlString(datasetId)}                                   AS dataset_id,
      TRY_CAST(${c('BioGRID Interaction ID')} AS BIGINT)        AS biogrid_interaction_id,

      ${c('Entrez Gene Interactor A')}                           AS entrez_a,
      ${nodeA}                                                   AS biogrid_id_a,
      ${c('Systematic Name Interactor A')}                       AS systematic_a,
      ${c('Official Symbol Interactor A')}                       AS symbol_a,
      ${c('Synonyms Interactor A')}                              AS synonyms_a,
      TRY_CAST(${c('Organism ID Interactor A')} AS INTEGER)      AS organism_id_a,
      ${c('Organism Name Interactor A')}                         AS organism_name_a,
      ${c('SWISS-PROT Accessions Interactor A')}                 AS swissprot_a,
      ${c('TREMBL Accessions Interactor A')}                     AS trembl_a,
      ${c('REFSEQ Accessions Interactor A')}                     AS refseq_a,

      ${c('Entrez Gene Interactor B')}                           AS entrez_b,
      ${nodeB}                                                   AS biogrid_id_b,
      ${c('Systematic Name Interactor B')}                       AS systematic_b,
      ${c('Official Symbol Interactor B')}                       AS symbol_b,
      ${c('Synonyms Interactor B')}                              AS synonyms_b,
      TRY_CAST(${c('Organism ID Interactor B')} AS INTEGER)      AS organism_id_b,
      ${c('Organism Name Interactor B')}                         AS organism_name_b,
      ${c('SWISS-PROT Accessions Interactor B')}                 AS swissprot_b,
      ${c('TREMBL Accessions Interactor B')}                     AS trembl_b,
      ${c('REFSEQ Accessions Interactor B')}                     AS refseq_b,

      ${c('Experimental System')}                                AS experimental_system,
      lower(${c('Experimental System Type')})                    AS experimental_system_type,
      ${authorCol}                                               AS author,
      ${pubSource}                                               AS publication_source,
      ${throughputCol}                                           AS throughput,
      ${c('Score')}                                              AS score,
      ${c('Modification')}                                       AS modification,
      ${c('Qualifications')}                                     AS qualifications,
      ${c('Tags')}                                               AS tags,
      ${c('Source Database')}                                    AS source_database,

      ${c('Ontology Term IDs')}                                  AS ontology_term_ids,
      ${c('Ontology Term Names')}                                AS ontology_term_names,
      ${c('Ontology Term Categories')}                           AS ontology_term_categories,
      ${c('Ontology Term Qualifier IDs')}                        AS ontology_term_qualifier_ids,
      ${c('Ontology Term Qualifier Names')}                      AS ontology_term_qualifier_names,
      ${c('Ontology Term Types')}                                AS ontology_term_types,

      least(${nodeA}, ${nodeB})                                  AS node_lo,
      greatest(${nodeA}, ${nodeB})                               AS node_hi,
      CASE WHEN ${nodeA} IS NULL OR ${nodeB} IS NULL THEN NULL
           ELSE least(${nodeA}, ${nodeB})::VARCHAR
                || ${sqlString(PAIR_KEY_SEPARATOR)}
                || greatest(${nodeA}, ${nodeB})::VARCHAR
      END                                                        AS pair_key,
      ${publicationKey}                                          AS publication_key,
      nullif(trim(regexp_replace(${authorCol}, '\\s*\\([0-9]{4}\\)\\s*$', '')), '')
                                                                 AS author_name,
      TRY_CAST(regexp_extract(${authorCol}, '\\(([0-9]{4})\\)', 1) AS INTEGER)
                                                                 AS publication_year,
      coalesce(contains(lower(${throughputCol}), 'low'), false)   AS throughput_low,
      coalesce(contains(lower(${throughputCol}), 'high'), false)  AS throughput_high,
      TRY_CAST(${c('Score')} AS DOUBLE)                          AS score_num,
      (${nodeA} = ${nodeB})                                      AS is_self_interaction,
      (TRY_CAST(${c('Organism ID Interactor A')} AS INTEGER)
        <> TRY_CAST(${c('Organism ID Interactor B')} AS INTEGER)) AS is_inter_species
    FROM ${readCsvExpr(fileName)}`
}

/** Rebuild the gene dictionary for one dataset from its interaction rows. */
export function buildGenesInsert(datasetId: string): string {
  const d = sqlString(datasetId)
  return `
    INSERT INTO genes
    SELECT
      dataset_id,
      biogrid_id,
      any_value(symbol)        AS symbol,
      any_value(systematic)    AS systematic,
      any_value(entrez)        AS entrez,
      any_value(synonyms)      AS synonyms,
      any_value(organism_id)   AS organism_id,
      any_value(organism_name) AS organism_name,
      any_value(swissprot)     AS swissprot
    FROM (
      SELECT dataset_id, biogrid_id_a AS biogrid_id, symbol_a AS symbol,
             systematic_a AS systematic, entrez_a AS entrez, synonyms_a AS synonyms,
             organism_id_a AS organism_id, organism_name_a AS organism_name,
             swissprot_a AS swissprot
      FROM interactions WHERE dataset_id = ${d} AND biogrid_id_a IS NOT NULL
      UNION ALL
      SELECT dataset_id, biogrid_id_b, symbol_b, systematic_b, entrez_b, synonyms_b,
             organism_id_b, organism_name_b, swissprot_b
      FROM interactions WHERE dataset_id = ${d} AND biogrid_id_b IS NOT NULL
    )
    GROUP BY dataset_id, biogrid_id`
}

/** Rebuild the publication dictionary for one dataset from its interaction rows. */
export function buildPublicationsInsert(datasetId: string): string {
  const d = sqlString(datasetId)
  return `
    INSERT INTO publications (
      dataset_id, publication_key, ref_kind, ref_id, author_label, author_name, year,
      record_count, pair_count, system_count
    )
    SELECT
      dataset_id,
      publication_key,
      regexp_extract(publication_key, '^([^:]+):', 1)              AS ref_kind,
      regexp_replace(publication_key, '^[^:]+:', '')               AS ref_id,
      any_value(author)                                            AS author_label,
      any_value(author_name)                                       AS author_name,
      max(publication_year)                                        AS year,
      count(*)                                                     AS record_count,
      count(DISTINCT pair_key)                                     AS pair_count,
      count(DISTINCT experimental_system)                          AS system_count
    FROM interactions
    WHERE dataset_id = ${d} AND publication_key IS NOT NULL
    GROUP BY dataset_id, publication_key`
}

/**
 * Aggregated protein-pair view: one row per undirected interaction, carrying every
 * signal the trust model consumes. Created once as a macro-style view over all
 * datasets; callers filter by `dataset_id`.
 */
export const PAIR_VIEW = `
  CREATE OR REPLACE VIEW ppi_pairs AS
  SELECT
    dataset_id,
    pair_key,
    node_lo,
    node_hi,
    any_value(CASE WHEN biogrid_id_a = node_lo THEN symbol_a ELSE symbol_b END) AS symbol_lo,
    any_value(CASE WHEN biogrid_id_a = node_hi THEN symbol_a ELSE symbol_b END) AS symbol_hi,
    any_value(CASE WHEN biogrid_id_a = node_lo THEN organism_id_a ELSE organism_id_b END)
      AS organism_lo,
    any_value(CASE WHEN biogrid_id_a = node_hi THEN organism_id_a ELSE organism_id_b END)
      AS organism_hi,
    count(*)                                        AS record_count,
    count(DISTINCT publication_key)                 AS publication_count,
    count(DISTINCT experimental_system)             AS system_count,
    count(DISTINCT author_name)                     AS author_count,
    list(DISTINCT experimental_system)              AS systems,
    list(DISTINCT publication_key)                  AS publications,
    bool_or(experimental_system_type = 'physical')  AS has_physical,
    bool_or(experimental_system_type = 'genetic')   AS has_genetic,
    count(*) FILTER (WHERE throughput_low)          AS low_throughput_records,
    count(*) FILTER (WHERE throughput_high)         AS high_throughput_records,
    min(publication_year)                           AS first_year,
    max(publication_year)                           AS last_year,
    max(score_num)                                  AS max_score,
    bool_or(is_self_interaction)                    AS is_self_interaction,
    bool_or(is_inter_species)                       AS is_inter_species
  FROM interactions
  WHERE pair_key IS NOT NULL
  GROUP BY dataset_id, pair_key, node_lo, node_hi`

/**
 * Sanity check used by tests: every canonical column is projected into the
 * interactions table, so adding a column to `columns.ts` without wiring it into the
 * schema is caught rather than silently dropped.
 */
export function unmappedCanonicalColumns(): string[] {
  const projected = new Set(PROJECTED_COLUMNS)
  return CANONICAL_COLUMNS.filter((c) => !projected.has(c))
}

/** Canonical columns read by `buildInteractionSelect`. */
const PROJECTED_COLUMNS: readonly CanonicalColumn[] = [
  'BioGRID Interaction ID',
  'Entrez Gene Interactor A',
  'BioGRID ID Interactor A',
  'Systematic Name Interactor A',
  'Official Symbol Interactor A',
  'Synonyms Interactor A',
  'Organism ID Interactor A',
  'Organism Name Interactor A',
  'SWISS-PROT Accessions Interactor A',
  'TREMBL Accessions Interactor A',
  'REFSEQ Accessions Interactor A',
  'Entrez Gene Interactor B',
  'BioGRID ID Interactor B',
  'Systematic Name Interactor B',
  'Official Symbol Interactor B',
  'Synonyms Interactor B',
  'Organism ID Interactor B',
  'Organism Name Interactor B',
  'SWISS-PROT Accessions Interactor B',
  'TREMBL Accessions Interactor B',
  'REFSEQ Accessions Interactor B',
  'Experimental System',
  'Experimental System Type',
  'Author',
  'Publication Source',
  'Throughput',
  'Score',
  'Modification',
  'Qualifications',
  'Tags',
  'Source Database',
  'Ontology Term IDs',
  'Ontology Term Names',
  'Ontology Term Categories',
  'Ontology Term Qualifier IDs',
  'Ontology Term Qualifier Names',
  'Ontology Term Types',
]
