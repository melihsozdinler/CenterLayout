# Algorithms

What each one computes, why it is here, and what it costs.

Every graph traversal is **iterative**. Recursive depth-first search on a real PPI
network reaches depths in the tens of thousands and overflows the JavaScript stack — a
failure that appears only on real data, never on a test fixture. The suite includes a
20,000-node path to keep it that way.

## The graph

Built from scored interactions. Nodes are re-indexed to a dense `0..n-1` range so
adjacency lives in flat arrays. Self-interactions are dropped: they are real biology,
but a self-loop breaks the invariants everything here relies on, and says nothing about
network structure.

Node indexing is deterministic — derived from sorted pair keys, never from query order —
so every algorithm's tie-breaking depends only on the data.

## Connected components — `O(n + m)`

The disjoint pieces, renumbered so component 0 is the largest.

## Biconnected components, articulation points, bridges — `O(n + m)`

Hopcroft–Tarjan, iteratively.

An **articulation point** is a protein whose removal disconnects the network; a
**bridge** is a single interaction doing the same. Both are precisely where one badly
supported edge does the most damage, which is why they pair naturally with the trust
score. On the SARS-CoV-2 network of release 5.0.260, 2,848 of 34,540 interactions are
bridges and only 32 proteins are articulation points: the periphery
is almost entirely tree-like, and almost every peripheral protein hangs from one
unreplicated claim.

## k-core decomposition — `O(n·m)` as implemented

The `k`-core is the maximal subgraph where every node has degree at least `k`. Survives
noise far better than a degree threshold, because removing a low-degree node can drop
its neighbours below the threshold too.

## Maximal cliques — worst-case exponential

Bron–Kerbosch with pivoting, over a degeneracy ordering. A maximal clique is a set of
proteins every one of which is reported to interact with every other — the
graph-theoretic shadow of a protein complex.

Enumeration is exponential in the worst case, so the caller can cap it; when the cap
bites, `truncated` says so rather than presenting a partial list as complete.

The degeneracy ordering bounds the outer loop by the graph's degeneracy, which for
biological networks is far below the maximum degree.

## Edge betweenness — `O(n·m)` per computation

Brandes' algorithm, restricted to the currently active edges.

## Edge removal

Two orders, answering different questions.

**`betweenness`** (Girvan–Newman) removes the edge carrying the most shortest paths. It
asks where the joins are, and is blind to whether the evidence for an edge is any good.
Recomputing betweenness after every removal is what makes the classical method
impractical at scale, so `recomputeEvery` is exposed.

**`trust-ascending`** removes the least well-supported edge first. It asks the question
a biologist actually has: what survives if I only believe the evidence? Girvan–Newman
finds the joins in the network *as reported*, which includes every one-paper screen hit;
peeling by trust finds the structure that would survive replication.

Both record a curve — components, largest-component fraction and Newman modularity at
each step — and report the partition with the highest modularity.

## Contraction

Groups nodes by connected components, biconnected components, cliques, k-core, or an
externally supplied partition, then contracts each group to a single node.

High-level edges carry **trust mass**: the summed trust of the original edges spanning
two modules. That says how much evidence connects two complexes, rather than merely
that something does. Each high-level node keeps its membership, so any of it can be
expanded back.

Where groups overlap — a protein in several cliques — the first group claims it for
edge attribution, so trust mass is counted once rather than multiplied across overlaps.

## Communities (Louvain) — `O(m log n)` in practice

Modularity optimization: move each node to the neighbouring community that most
improves modularity, aggregate the communities into single nodes, repeat. Weighted by
trust, so a community is held together by *evidence* — a module resting on one paper
per interaction does not survive as one.

**Deterministic**, unlike the published algorithm, which visits nodes in random order
and gives a different partition per run. Nodes are visited in index order and ties go to
the community a node is already in. A figure that cannot be regenerated is not evidence.

Worth knowing before concluding that two complexes are one: classical modularity has a
resolution limit, and merges modules smaller than roughly √(2m) edges. `resolution`
above 1 gives smaller communities.

## The high-level view — recursive contraction

`autoContract` is what the **Modules** view calls, and it differs from `contract` in one
way that matters: it can be applied to its own output.

It contracts by **biconnected components** where they decompose the graph — more than
one module, none holding essentially all of it. That is the honest first choice, being
structural rather than optimized, and on a sparsely studied organism it is most of the
answer — the sparser the network, the more of it is bridges.

But a well-studied core *is* biconnected, so the decomposition returns it unchanged.
Drilling into it would show exactly what you clicked, forever. When that happens the
graph is divided by **communities** instead, which always splits and can split again.

Two things are done for the picture rather than for the algorithm:

- **Groups are made disjoint** before drawing — each protein is claimed by the largest
  group containing it. Biconnected components share their articulation points, and a
  protein drawn in two modules is counted twice, sized twice, and ambiguous to click.
  So a module shows its own proteins, not its boundary.
- **The long tail is folded**, not dropped, into one `n small modules` node. Along a
  chain of bridges most modules are a single protein; dropping them would shrink the
  network slightly at every level, silently.

How often is each chosen? Of the 41 organisms in release 5.0.260 whose physical network
has at least 100 proteins, **10 decompose structurally** — *Bos taurus* (605 proteins,
586 interactions), *Danio rerio* (529, 545), *Gallus gallus* (451, 472), Human
Herpesvirus 1 (324, 395) and six more, all of them networks with scarcely more
interactions than proteins. The other 31, human and yeast among them, have a core that
is biconnected by construction and need modularity.

On the full human interactome — 29,104 proteins, 1,047,820 interactions, no trust
threshold — the top level is 14 communities in 2.0 s, the largest holding 5,624
proteins. Opening it gives 9 communities (largest 1,276), then 10 (largest 267), then 8
(largest 53), which is drawn as proteins. Four clicks and 2.2 s of computation from a
million interactions to something a person can read.

One case has no answer to give: a hub and its partners. Every division of a star scores
worse than leaving it whole, so the contraction returns a single module — and rather
than draw one circle, or let a click open the same picture again, the view falls back to
drawing the proteins and says why.

## Matrix seriation

Breadth-first traversal within components, largest first, visiting the highest-degree
neighbour first. Puts each connected module in a contiguous block and keeps densely
linked proteins adjacent, so complexes appear as blocks on the diagonal.

Spectral seriation orders slightly better but needs an eigenvector, which is a poor
trade for a view the user re-orders interactively.

## Center Layout 2.0 — `O(n log n)`

Closed-form, no physics, no iteration to convergence.

Systems are sorted by publication count and given angular sectors proportional to their
share, with a floor so a one-paper method stays clickable. Publications are assigned to
the sector of their method — or, for a multi-method paper, the one nearest the circular
mean of its methods — and packed into a fan filling that sector, with row capacity
growing with radius since an outer row spans a longer arc.

Determinism is the point. String ordering is explicitly locale-independent, because
`localeCompare` would otherwise let two machines sort method names differently, and a
layout whose value rests on reproducibility cannot afford that.
