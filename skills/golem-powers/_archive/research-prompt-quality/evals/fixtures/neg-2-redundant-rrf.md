# NEG-2 — redundant RRF deep-research proposal (gen-10)

> Source: `skill-creator/docs.local/weave-2026-05-29/gen-10-dashboard.html` `#src-rrf`. Proposes new research despite ≥6 prior artifacts on disk (see SCOPING).

```
Evaluate ranking/fusion for a hybrid memory-retrieval system that combines SQLite FTS5 keyword search with vector (embedding) search. Each chunk carries: an importance score (1-10), a recency timestamp, extracted key_facts, and knowledge-graph entity links. The current system uses Reciprocal Rank Fusion (RRF) with a Cormack k constant, which discards importance, recency, key_facts, and KG-link signal — it only fuses ranks.

Answer, with citations and concrete formulas/code:
1. Compare rank-based RRF vs score-based fusion (normalized score combination) for this signal-rich setting.
2. Design a weighted fusion that incorporates importance + recency decay + KG-link boosts WITHOUT destroying the calibration of the base FTS/vector relevance. Give the formula and sensible default weights.
3. Should we add a learned re-ranker (cross-encoder) as a final stage? Cost/latency tradeoffs for a local, sub-second memory system.
4. How to evaluate the change offline (metrics, a labeled probe set) so we can prove a ranking lift, not just swap heuristics.
Deliverable: a recommended ranking pipeline + the exact fusion formula + an eval plan. Cite sources; do not assert benchmark numbers without a citation.
```
