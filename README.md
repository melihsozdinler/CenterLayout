# ProLiVis — Protein–Protein Interaction Literature Visualization

Visualize BioGRID protein–protein interaction (PPI) networks **through their literature**:
publications and experimental methods are first-class nodes, so you see *who found what, with
which method* instead of a protein hairball.

> **Paper:** Melih Sozdinler, *ProLiVis: Protein-Protein Interaction Literature Visualization
> System*, [arXiv:2111.12794](https://arxiv.org/abs/2111.12794).

---

## Two things live in this repository

| Path | What it is | Status |
| --- | --- | --- |
| [`web/`](web/) | **ProLiVis 2.0** — a zero-install static web application. TypeScript, runs entirely in the browser. | Active development |
| repository root (`*.cpp`, `*.h`, `CenterLayout.pro`) | **ProLiVis 1.0** — the original Qt desktop application described in the paper. | Archived, unmaintained |

The 1.0 sources are kept verbatim as the reference implementation behind the published figures.
They are *not* buildable as-is: the Qt `.ui` files and the external layout engine
(`ProlivisAuto.exe`) were never part of this repository, and the Qt 4 → Qt 5 port is incomplete.
ProLiVis 2.0 is a from-scratch rewrite, not a port.

---

## ProLiVis 2.0

![Center layout of the SARS-CoV-2 literature](paper/figures/center-layout-aggregated.png)

*The SARS-CoV-2 literature from BioGRID 5.0.260: 1,688 publications across 19
experimental methods. Sector width is share of the literature, node area is
interactions contributed — so the widest sectors are where most* papers *are, and the
largest nodes are where most* interactions *are. They are not the same methods.*

**What it does**

- Ingests BioGRID **offline** (drag in a `BIOGRID-*.tab3.zip`) or **online** (the REST
  API, with your own access key). The complete release — 2.9M records, 1.55 GB
  uncompressed — ingests in 78 seconds.
- Rebuilds the **center layout** — organism → experimental method → publication — as a
  deterministic layout, so a figure can be regenerated exactly.
- Adds five further views: adjacency matrix, UpSet of method combinations, bipartite
  publication↔protein with method lanes, literature timeline, and method chord.
- Scores every interaction with a documented **citation-trust** model: replication,
  **independent laboratories**, method diversity, assay directness, throughput,
  literature impact and currency. Unknown inputs are reported as unknown, never as zero.
- **Reads a network too large to draw** one level up: modules as nodes, evidence as
  links, and any module opens into its own high-level graph. Four clicks take you from
  the million-interaction human network to 53 proteins.
- Extracts structure: maximal cliques, biconnected components, articulation points,
  bridges, *k*-cores, and edge-removal cascades — including removal in
  *trust-ascending* order, which asks what survives if you only believe the evidence.
- **Collects literature into datasets**: tick papers across several searches, visualize
  their combined network, and save it as a dataset in its own right — scorable,
  exportable, reproducible, and remembering which publications produced it.
- **Compares and merges** datasets across organisms, releases or queries, keeping
  per-edge provenance.
- Exports to CSV/TSV, GraphML, GML, SIF (Cytoscape) and SVG, plus a session manifest
  that reproduces any figure.

**Your data stays on your machine.** Bulk dumps are parsed and queried locally in the browser.
Nothing is uploaded; network access is used only if you turn on online mode or literature
enrichment.

### Install

Nothing, if you like: open <https://melihsozdinler.github.io/CenterLayout/> and drag in
a BioGRID download. Otherwise:

```bash
git clone https://github.com/melihsozdinler/CenterLayout
cd CenterLayout/web
npm ci
npm run dev
```

Requires Node.js ≥ 20.19. [`docs/INSTALL.md`](docs/INSTALL.md) covers all four options,
including air-gapped use, which BioGRID files to download, and troubleshooting.

### Documentation

| | |
| --- | --- |
| [`docs/INSTALL.md`](docs/INSTALL.md) | Getting it running, and getting the data |
| [`docs/USAGE.md`](docs/USAGE.md) | The views, scoring, analysis, comparison, export |
| [`docs/TRUST.md`](docs/TRUST.md) | The citation-trust model in full, with its equations |
| [`docs/DATA.md`](docs/DATA.md) | Schema, and three things about BioGRID worth knowing |
| [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) | What each algorithm computes and what it costs |

### Development

```bash
npm run lint      # eslint
npm test          # vitest unit tests
npm run build     # type-check + production build to dist/
npm run test:e2e  # playwright end-to-end against the built app
```

---

## ProLiVis 1.0 (archived)

The original Qt application. Screenshots from the paper:

![Center layout: experimental-method hubs fanning into publication clouds](img/CenterLayout01.PNG)
![Full organism overview](img/CenterLayout02.PNG)
![Sparse organism](img/CenterLayout03.PNG)

---

## Licensing

- `web/` and all ProLiVis 2.0 material: **MIT** (see [`LICENSE`](LICENSE)).
- The archived 1.0 C++ sources carry **GPL-3** headers
  (© 2013 Melih Sozdinler, Turkan Haliloglu, Can Ozturan) and remain under those terms.

## Citing

Until the ProLiVis 2.0 paper is published, please cite the original:

```bibtex
@article{sozdinler2021prolivis,
  title   = {ProLiVis: Protein-Protein Interaction Literature Visualization System},
  author  = {Sozdinler, Melih},
  journal = {arXiv preprint arXiv:2111.12794},
  year    = {2021}
}
```
