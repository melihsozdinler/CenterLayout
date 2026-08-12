# Using ProLiVis 2.0

Start with [`INSTALL.md`](INSTALL.md) to get the tool and the data. This page covers
what to do once a dataset is loaded.

## The views

| View | Question it answers |
| --- | --- |
| **Center layout** | Which methods does this literature use, and who used them? |
| **Adjacency matrix** | What does the whole network look like without a hairball? |
| **UpSet** | Which combinations of methods actually co-occur? |
| **Bipartite** | Which proteins did each publication actually touch? |
| **Timeline** | *When* did we come to believe this? |
| **Chord** | Which methods tend to support the same interactions? |
| **High-level graph** | What are the modules, and how much evidence connects them? |

### Center layout

The organism sits at the centre. Experimental methods form a ring around it, each
owning an angular sector sized by its share of the literature. Publications fan outward
within their method's sector. Node area is proportional to interactions contributed.

Angle and radius both carry meaning: angle identifies the method, radius the level.
Reading a figure therefore has a grammar — a wide sector with small nodes is a method
many papers use but that yields few interactions each (structural work); a narrow
sector with one huge node is a single large screen.

Options:

- **Fold methods with fewer than *n* publications** collapses the long tail into one
  `Other methods` node. The tail otherwise consumes half the circle in slivers too thin
  to read. Zero disables it.
- **Publications using several methods** — placed once between their methods (default,
  one paper is one node) or duplicated into each. The first is honest about how large
  the literature is; the second reads more cleanly per method.

The layout is deterministic: the same query always produces the same coordinates, which
is what makes an exported figure reproducible.

### From the literature to the interactions

Clicking a **publication** node in the literature view opens the network that paper
reported. Clicking a **method** node opens every interaction that technique has
produced; the folded "Other methods" node opens all of them together. This is the
drill-down the literature view exists for — a publication node answers *who reported
this*, and clicking it answers *and what did they report* — and it is what ProLiVis 1.0
offered from its publication list.

**Find literature** in the sidebar does the same from a search: by author, year, PubMed
id, DOI, or enriched title. With an empty box it lists the biggest contributors, which
answers "what is this network mostly made of". Each result shows how many interactions
and how many methods the paper contributed before you commit to opening it, and links
out to PubMed or doi.org.

A scoped network shows *all* of that paper's or method's interactions — the trust
threshold does not apply, because you asked for a specific bounded set. Trust stays
visible as edge colour and weight. The breadcrumb above the canvas returns you to the
whole network.

### Reading a network

Clicking a protein centres the view on it and opens a panel listing every interaction
it takes part in, with the evidence behind each: methods, publications by author and
year, throughput split. Any partner can be expanded, or clicked to walk to it — the
breadcrumb above the canvas keeps a trail, so **← Whole network** and **Back** always
return you to where you were.

Layouts are on the canvas, not in the sidebar, because choosing one is the main thing
you do while reading a network:

| Layout | Answers |
| --- | --- |
| **Force** | What clusters together? Best under ~1,200 proteins. |
| **Layered** | How many hops apart are these? Layers are graph distance from the best-connected protein, or from the focused one. Over-full layers wrap into sub-rows. |
| **Grouped** | What are the modules? |
| **Circular** | A stable reference arrangement. |

Density has three separate controls because they fail differently: **minimum partners**
drops the periphery (usually the effective one, since a PPI network is mostly degree-1
leaves), **interactions drawn** keeps the best-supported but can leave a protein looking
unconnected because its edges lost a global race, and **hops** sets the radius of a
focused view. The trust threshold is the honest cut.

While a protein is focused the trust threshold does not apply — you asked to see
everything it interacts with, so trust shows as edge colour and weight instead.

### Other databases

The protein panel links out to BioGRID, STRING, UniProt, IntAct, AmiGO and NCBI Gene.
Where a site permits framing its page opens beside the network; where it does not, the
link opens a tab. STRING blocks framing, so its network *image* is shown instead —
which is what ProLiVis 1.0 did.

The list is yours: **External databases** in the sidebar edits it, with a base URL and a
template using `{symbol}`, `{biogridId}`, `{entrez}`, `{swissprot}`, `{organismId}` or
`{systematic}`. Additions persist in this browser. Opening a link sends the identifier
to that site; nothing is contacted until you ask.

## Trust scoring

Every interaction gets a score in `[0, 1]` from seven terms, described in full in
[`TRUST.md`](TRUST.md). The things worth knowing while using it:

- Terms whose inputs are unknown are reported as unknown, not as zero, and the
  remaining weights are renormalized. `coverage` tells you how much of the model was
  informed.
- Filtering by trust is the fastest way to see how thin the evidence is. On the
  coronavirus release, raising the threshold to 0.2 takes the network from 880
  interactions to 126: most reported interactions rest on a single publication.
- Re-weighting is instant, because evidence is gathered once and scoring is pure
  arithmetic over it. Move the weights and watch the network re-colour.

## Structural analysis

```js
const graph = await prolivis.graph({ datasetId }, { minScore: 0.3 })

prolivis.cliques(graph, { minSize: 3 })   // candidate complexes
prolivis.modules(graph)                   // articulation points and bridges
prolivis.cores(graph)                     // the dense part
prolivis.contract(graph, { strategy: 'cliques' })
```

**Cliques** are sets of proteins every one of which is reported to interact with every
other — the graph-theoretic shadow of a complex. On the coronavirus set this recovers
the R2TP/prefoldin co-chaperone complex and the STING–TRAF3–TBK1 module without being
told about either.

**Articulation points and bridges** are the proteins and single interactions holding
modules together. They are exactly where one badly supported edge does the most damage,
which is why they pair naturally with the trust score: sort the bridges by trust and
you have a list of the load-bearing claims that nobody has replicated.

**Edge removal** comes in two orders. `betweenness` is classical Girvan–Newman and asks
where the joins are. `trust-ascending` removes the least-supported edge first and asks
what survives if you only believe the evidence — usually the more interesting question.

**Contraction** turns modules into single nodes carrying the trust mass of the links
between them. This is the scalable answer to the hairball: a hundred thousand
interactions cannot be read as a node-link diagram, a hundred modules can, and any of
them can be expanded back.

## Comparing and merging

```js
const result = await prolivis.compare({
  left:  { datasetId: release_5_0_260, label: 'Old' },
  right: { datasetId: release_5_1_0,   label: 'New' },
})
prolivis.setOperation(result, 'intersection')
await prolivis.merge([{ datasetId: a }, { datasetId: b }])
```

Comparison is by BioGRID gene id by default. Use `bySymbol: true` to compare across
organisms, where the same protein has different gene ids — but not *within* a
cross-species dataset, where distinct organisms reuse symbols.

Merging collapses records present in more than one source, so merging a release with
its successor does not double every unchanged interaction and inflate every replication
count.

## Exporting

| Format | For |
| --- | --- |
| CSV / TSV | Spreadsheets, R, pandas. One row per interaction, every trust term its own column |
| SIF | Cytoscape, quickly |
| GraphML | Cytoscape, Gephi, yEd, with trust and every term as typed edge attributes |
| GML | OGDF, Gephi, yEd |
| SVG | Publication figures — vector, every node a separate editable object |
| Session manifest | Reproducing a figure later |

The manifest records the BioGRID release, the query, the filters, the trust
configuration and the layout options. With a deterministic layout, that is enough to
regenerate a figure exactly — which ProLiVis 1.0 could not do even for its own author.

## SQL

The loaded data is a real database, and it is yours:

```js
await prolivis.sql(`
  SELECT symbol_lo, symbol_hi, publication_count, system_count
  FROM ppi_pairs
  WHERE dataset_id = '${datasetId}'
  ORDER BY publication_count DESC
  LIMIT 20`)
```

Tables: `interactions` (one row per BioGRID record, plus derived columns), `genes`,
`publications`, `literature` (enrichment, shared across datasets), `datasets`
(provenance), and the `ppi_pairs` view (one row per interaction with its evidence
aggregated). See [`DATA.md`](DATA.md) for the schema.
