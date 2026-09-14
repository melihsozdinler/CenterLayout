# Installing ProLiVis 2.0

ProLiVis runs entirely inside a web browser. There is no server, no database to
administer, and no Python or R environment to reconcile with your existing one. Pick
whichever of the four options below matches how much you want to install.

**Your data stays on your machine.** BioGRID files you open are parsed and queried
locally. Nothing is uploaded. The network is used only if you turn on online mode
(queries to thebiogrid.org) or literature enrichment (OpenAlex and PubMed), and both
are optional.

---

## Requirements

A current browser: Chrome, Edge, Firefox or Safari from the last two years or so.
Specifically, ProLiVis needs WebAssembly with exception handling, and — for keeping
your loaded data between visits — the Origin Private File System.

| | Works | Data kept between visits |
| --- | --- | --- |
| Chrome / Edge 108+ | yes | yes |
| Firefox 111+ | yes | yes |
| Safari 16.4+ | yes | yes |
| Safari private browsing | yes | **no** — storage is blocked, the app says so |
| Internet Explorer | no | — |

Memory matters more than CPU. A single organism needs a few hundred megabytes; the
complete `BIOGRID-ALL` release wants 4 GB or more of free RAM.

---

## Option 1 — Nothing to install

Open the hosted build:

**<https://melihsozdinler.github.io/CenterLayout/>**

Then drag a BioGRID download onto the window, or press **Open a BioGRID file…**. See
[Getting the data](#getting-the-data) below.

This is the same build as every other option; it is served as static files and does
not send your data anywhere.

## Option 2 — Local copy, no toolchain

Download `prolivis-dist.zip` from the
[releases page](https://github.com/melihsozdinler/CenterLayout/releases), unzip it, and
serve the folder with any static web server:

```bash
cd prolivis-dist
npx serve .          # or: python3 -m http.server 8080
```

Then open the address it prints.

Opening `index.html` directly from the filesystem will **not** work: browsers refuse
to load WebAssembly modules and web workers over `file://`. Any static server will do;
it does not need to be Node.

## Option 3 — From source

```bash
git clone https://github.com/melihsozdinler/CenterLayout
cd CenterLayout/web
npm ci
npm run dev
```

Requires Node.js 20.19 or newer. `npm run dev` starts a development server with hot
reloading; `npm run build` produces a `dist/` folder identical to option 2.

Useful commands:

```bash
npm run lint       # eslint
npm test           # unit tests (vitest)
npm run build      # type-check and build to dist/
npm run test:e2e   # end-to-end tests against the built app (playwright)
npm run figures    # regenerate the paper's figures
```

## Option 4 — Air-gapped or offline

ProLiVis needs the network only for online mode and literature enrichment. With those
untouched, the build from option 2 or 3 works with no connectivity at all — the
WebAssembly database engine is bundled with the application rather than fetched from a
CDN, specifically so that this is true.

To use ProLiVis on a machine with no internet access:

1. On a connected machine, run `npm ci && npm run build` and copy `web/dist/` across.
2. Also copy the BioGRID download you want (see below).
3. On the air-gapped machine, serve `dist/` with any static server and open it.

Everything except online mode and enrichment works: ingest, all views, the trust
model's evidence-side terms, every graph algorithm, and every export. Use the
`evidence-only` trust preset, which is designed for exactly this case and asks nothing
of the literature.

---

## Getting the data

ProLiVis reads BioGRID's **tab3** format, either as the `.zip` you download or as an
unzipped `.txt`. It also accepts **tab2**, which is what the REST API returns.

From <https://downloads.thebiogrid.org/BioGRID>:

| File | What it is | Size | Use it when |
| --- | --- | --- | --- |
| `BIOGRID-ORGANISM-LATEST.tab3.zip` | One file per organism, ~80 of them | ~200 MB | You want one species. **Start here.** |
| `BIOGRID-ALL-LATEST.tab3.zip` | Everything | ~500 MB | You want cross-species scope |
| `BIOGRID-CORONAVIRUS-LATEST.tab3.zip` | Curated coronavirus set | ~5 MB | A quick trial — it is small and interesting |
| `BIOGRID-MV-Physical-LATEST.tab3.zip` | Multi-validated physical only | ~10 MB | You only want well-supported interactions |

Drop the `.zip` in as-is; there is no need to unzip. The ORGANISM bundle contains one
file per organism, so ProLiVis will ask which one you want.

**Do not download** `mitab`, `psi`, `psi25` or `tab1` — ProLiVis does not read those,
and will tell you so rather than failing obscurely.

### How long ingest takes

Measured in Chrome on an Apple M-series laptop, against real releases:

| Dataset | Records | Ingest | Then |
| --- | --- | --- | --- |
| Coronavirus (5.0.260) | 76,632 | 12 s | aggregation queries in ~20 ms |
| **BIOGRID-ALL (5.0.260)** | **2,916,237** | **78 s** | see below |

The full release — 181 MB zipped, 1.55 GB uncompressed — yields 2,266,580 interactions,
77,675 publications, 92,379 genes and 98 organisms. Afterwards:

| Operation | Time |
| --- | --- |
| Organism list | 0.7 s |
| Experimental systems | 0.4 s |
| Centre layout, human (16,178 nodes) | 0.8 s |
| Trust scoring, human (1,068,827 interactions) | 12 s |
| Building the graph at trust ≥ 0.3 (14,567 proteins) | 11 s |
| Maximal cliques over that graph | 0.4 s |

Scoring a million interactions is the slow step, and it is inherent: every interaction
gets seven terms computed in JavaScript so that re-weighting stays instant afterwards.
Working one organism at a time keeps everything under a second.

You pay ingest once. The database is kept in your browser's storage, so the next visit
opens immediately — which is why the app asks you to notice if storage is unavailable.

---

## Online mode (optional)

To query BioGRID directly instead of downloading a file, you need a free access key.

1. Register at <https://webservice.thebiogrid.org>. They email you a 32-character key.
2. Pass it to `prolivis.connect('<key>')` in the browser console, then
   `prolivis.fetchRemote({ geneList: ['TP53'], organismId: 9606 })`. Online mode has no
   panel in the interface yet; it is API-only.

The key is stored in your browser's local storage and is sent only to thebiogrid.org.
It is never transmitted anywhere else and is not part of any export or manifest.

Online mode is best for targeted questions — one gene and its neighbourhood — because
the API returns 10,000 records per request. For a whole organism, downloading the file
is faster.

## Literature enrichment (optional)

Enrichment fetches citation counts, journals and author institutions for the
publications BioGRID cites, from [OpenAlex](https://openalex.org) with NCBI PubMed as a
fallback. Neither needs an account or a key.

It powers two of the trust model's seven terms — *literature impact* and *independence*
— and without it those terms are reported as unknown rather than guessed. You can set a
contact email in the settings, which puts requests in OpenAlex's faster pool; it is
optional and off by default.

---

## Troubleshooting

**"Data will not be saved"** — the browser will not give ProLiVis persistent storage.
Usually this is private browsing, or a second ProLiVis tab already holding the
database. Close the other tab and reload. The app still works; your loaded data just
will not survive a reload.

**"This does not look like BioGRID tabular data"** — the file is a format ProLiVis does
not read. Check you downloaded `.tab3.zip` and not `mitab`, `psi` or `psi25`.

**The tab crashes while loading a large file** — the browser ran out of memory. Load a
single organism rather than `BIOGRID-ALL`, close other tabs, or use a machine with more
RAM. Chrome tends to have more headroom than Safari here.

**Ingest seems stuck** — a multi-gigabyte archive can spend a long time in one chunk
without visible progress. Watch the record count in the sidebar rather than the
progress bar; if that is climbing, it is working.

**A query returns nothing in online mode** — check the access key is exactly the 32
characters they sent, with no trailing space, and that your gene names match the
organism you selected. Turning on `searchSynonyms` helps when a paper used an older
gene name.

**Nothing renders after loading** — open the browser console. ProLiVis exposes its API
as `window.prolivis`; `await prolivis.datasets()` will tell you whether the data
actually loaded, which separates a data problem from a drawing one.

---

## For scripting

Every capability is available programmatically as `window.prolivis`, in the browser
console or in a headless browser. This is a supported interface, not a debugging hook —
the tool's own tests and the paper's figures are generated through it.

```js
const dataset = await prolivis.load(file)
const scored  = await prolivis.score({ datasetId: dataset.datasetId })
const graph   = await prolivis.graph({ datasetId: dataset.datasetId }, { minScore: 0.4 })
const cliques = prolivis.cliques(graph, { minSize: 3 })
console.log(prolivis.exportTable(scored, 'csv'))
```

Arbitrary SQL against the loaded data is available too:

```js
await prolivis.sql(`
  SELECT experimental_system, count(*) AS n
  FROM interactions GROUP BY 1 ORDER BY n DESC`)
```

See [`USAGE.md`](USAGE.md) for the full surface.
