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

**What it does**

- Ingests BioGRID **offline** (drag in a `BIOGRID-*.tab3.zip` bulk download) or **online**
  (the BioGRID REST API, with your own access key).
- Rebuilds the **center layout** — organism → experimental method → publication — as a
  deterministic, reproducible radial layout.
- Adds further views: bipartite publication↔protein with method lanes, adjacency matrix + UpSet,
  hierarchical edge bundling + chord, and a literature timeline.
- Scores every interaction with a documented **citation-trust** model combining BioGRID evidence
  (replication, independent labs, method diversity, throughput) with external citation data from
  OpenAlex and PubMed.
- Extracts high-level structure: maximal cliques, biconnected components, articulation points and
  bridges, *k*-cores, communities, and edge-removal cascades.
- **Compares and merges** datasets across organisms, BioGRID releases, or queries, keeping per-edge
  provenance.
- Exports to CSV/TSV, JSON, GraphML, GML, SIF (Cytoscape), Parquet, SVG and PNG — plus a session
  manifest that reproduces any figure exactly.

**Your data stays on your machine.** Bulk dumps are parsed and queried locally in the browser.
Nothing is uploaded; network access is used only if you turn on online mode or literature
enrichment.

### Install

Full instructions, including air-gapped use, are in [`docs/INSTALL.md`](docs/INSTALL.md).
The short version:

```bash
git clone https://github.com/melihsozdinler/CenterLayout
cd CenterLayout/web
npm ci
npm run dev
```

Requires Node.js ≥ 20.19. Or skip installing entirely and open the hosted build.

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
