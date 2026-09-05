# Failure-Mode Catalog — FM1 to FM14

> Canonical catalog of failure modes the judges flag in `failure_modes_observed`. Sourced from Agent A's original audit + the W3.1 / W3.3 additions. The rubric (`grading-rubric.md` §8) lists FM1–FM11 plus FM-entity-leak; this catalog adds FM12, FM13, FM14 from operational experience.

---

## Tag table

| Tag | Name | When | Discoverer |
|---|---|---|---|
| FM1 | Duplicate stubs | Multiple chunk_ids with identical or near-identical content; inflate recall@k. | Agent A (2026-05-15) |
| FM2 | Paraphrase miss | Dense embedder fails to bridge synonyms / different phrasing (cider ↔ M1 fried). | Agent A |
| FM3 | Reserved | (Held for future use — keep numbering stable across rubric versions.) | — |
| FM4 | Reserved | (Held for future use.) | — |
| FM5 | Reserved | (Held for future use.) | — |
| FM6 | PreCompact pollution | Session-restore checkpoints surface for any query in that session's vocabulary. | Agent A |
| FM7 | Reserved | (Held for future use.) | — |
| FM8 | Importance inversion | `imp:0` chunks outrank `imp:5+` chunks on vector score alone. | Agent A |
| FM9 | Reserved | (Held for future use.) | — |
| FM10 | Reserved | (Held for future use.) | — |
| FM11 | Self-referential query echo | Chunk content is a paraphrase of the query (auto-summarizer ate the message). | Agent A |
| FM-entity-leak | Entity card returned where chunk expected | KG entity surfaces instead of a content chunk. | Agent A |
| FM12 | Judge-integrity-failure | Judge emits `(qid, chunk_id)` rows not in `corpus.jsonl` (hallucinated chunk_id or misaligned rows). | Run 1 incident — geminiJudge 18/77 off-corpus |
| FM13 | Judge-liveness-failure | Judge under-quota at liveness gate (< 95% of expected corpus rows): structurally absent (never spawned), PTY death mid-run, or context-window overflow — all collapse to the same FM13 signature. | Run 4 incident — gemini absent from row 1 (40/40 rows shadow_label={}; earlier framed as "s:60 PTY death" but the truth is "never spawned"). |
| FM14 | Fully-distinct-spread-3 | All judges disagree with spread=3 and no clear outlier → corpus pair too ambiguous to gold-lock. | W3.3 design (2026-05-16) |

Why some FM numbers are reserved: keep the FM space stable across rubric versions. New FMs get the next free number (FM3, FM4, FM5, FM7, FM9, FM10 are unallocated; use those in order before bumping to FM15+).

---

## How judges and the pipeline tag these

| Tag | Tagged by judge in `failure_modes_observed` array? | Tagged by pipeline in adjudication-log / FM-summary? |
|---|:---:|:---:|
| FM1 | ✅ | ✅ (when consensus_label is `3` but ≥ 3 duplicate chunk_ids share that label) |
| FM2 | ✅ (judge notes paraphrase miss in `missing_expected`) | ✅ (aggregated across queries) |
| FM6 | ✅ | ✅ |
| FM8 | ✅ | ✅ |
| FM11 | ✅ | ✅ |
| FM-entity-leak | ✅ | ✅ |
| FM12 | ❌ (the offending judge can't tag itself) | ✅ — Phase 2 crossref detects off-corpus rows |
| FM13 | ❌ (the offending judge isn't writing) | ✅ — `liveness-check.py` produces the report |
| FM14 | ❌ (no single judge can tag a tri-disagreement) | ✅ — `route-pending-rt.py` tags the discard |

The judge-side rubric (`grading-rubric.md`) only covers tags judges can self-report. The pipeline-side tags (FM12, FM13, FM14) are computed by harness scripts.

---

## FM definitions in detail

### FM1 — Duplicate stubs

Multiple chunks with near-identical content. Each gets the same numeric label, but the FM1 tag flags that **recall@k is being inflated** — one distinct piece of information is being counted N times.

Example: 4 brain_search hits all containing the literal string `"TechGym Cohort 5 lecture deck STRUCTURE … 13 slides, 45 min talk …"`. Each gets `3` but `failure_modes_observed: ["FM1"]` on each.

Downstream consequence: recall@4 looks like 100% but unique-chunk recall is 25%.

### FM2 — Paraphrase miss

Recorded at the query level, not the per-chunk level. When a query returns zero chunks (or all label-0/1 chunks) but a known-relevant chunk exists in the DB with paraphrased content, the dense embedder failed to bridge.

Example: Query `"Mac cider spill burned 350K chunks no backup local stability"` → zero results. But chunk `rt-b3cdba46-…` exists with content `"M1 Pro fried / cider / return to Apple"`. Tag `["FM2"]` on the query row + record in `missing_expected`.

### FM6 — PreCompact pollution

Sessions auto-create PreCompact Checkpoint chunks before context compression. These contain session-restoration metadata and surface for almost any query in that session's vocabulary — but they don't *answer* anything.

Example: Query `"techgym two sentence hook opener intro notebook"` returns a PreCompact chunk for session `feb75b2b…` because both share the word "techgym". The chunk content is session-restore boilerplate. Grade `0`, tag `["FM6"]`.

### FM8 — Importance inversion

BL ranks by vector similarity score, but `imp:0` chunks can outrank `imp:5+` chunks if vector overlap is higher. This breaks the implicit assumption that higher-importance content is closer to the answer.

Example: Top hit (importance 0) is a skillCreator handoff briefing tagged `correction:factual,auto-detected` that *mentions* the lecture but isn't the title/abstract. Second hit (importance 7) is the literal title/abstract. Score-based ranking surfaces the wrong one first.

### FM11 — Self-referential query echo

The auto-summarizer can replace a brain_search query's *original message* with a description of the search itself. The resulting chunk paraphrases the query instead of answering it.

Example: Query `"coach handoff pending items"` returns a chunk whose content reads *"The user is initiating a search for pending items related to a 'coach handoff' and has tagged the search with 'coach'."* — pure noise, grade `0`, tag `["FM11"]`.

### FM-entity-leak

A `brain_search` returns an entity card (e.g., a person card for "Etan") instead of a content chunk. Entity cards aren't grade-able as chunks; tag `["FM-entity-leak"]`, grade `cant-tell` (the entity isn't what the query asked for).

### FM12 — Judge-integrity-failure

A judge emits a `(qid, chunk_id)` row that doesn't exist in `corpus.jsonl`. The judge graded a chunk that wasn't part of the corpus row for that query. Discoverable only by the pipeline's `corpus_pairs - judge_rows` set diff.

Original incident: Run 1's geminiJudge emitted 18 off-corpus rows out of 77 (≈23%). Pipeline tagged them FM12-judge-integrity-failure and DISCARDED them from consensus.

This is the FM12 mentioned in the existing build-gold.py — it's a pipeline-level tag, NOT a judge-self-tag. Judges can't honestly tag themselves with this one.

### FM13 — Judge-liveness-failure

A judge ends a run with fewer than `(1 - tolerance) × |corpus|` rows. Causes (all collapse to the same FM13 detection signal):
- The judge silently died mid-run (PTY death, auth failure, model unavailable).
- The judge hit a context-window limit and stopped writing partway.
- The dispatcher timed out the judge before it finished.
- **The judge was never spawned at all** (e.g., Run 4's gemini case — see below).

Original incident: Run 4's gold.jsonl has `shadow_label == {}` on all 40 rows. Initial framing (Wave 2 synthesis, W3.1 design doc) called this "geminiJudge died at s:60 (PTY death)" — but empirical verification (2026-05-16) showed gemini was structurally absent from row 1, not "spawned-then-died". Either way, the symptom (no gemini rows in the gold) is identical and FM13 catches both.

W3.1's resolution: `liveness-check.py` runs after Phase 1 and fails-loud when any judge is under quota (or entirely absent). Doesn't try to distinguish "never spawned" from "spawned-then-died" — both are equally bad for gold-lock and both surface as the same FM13 signature. See `workflows/liveness-check.md`.

### FM14 — Fully-distinct-spread-3

The 3 judges return 3 distinct labels with spread 3 (e.g., one judge says `0`, one says `2`, one says `3`). No clear outlier; no clear majority. Per the routing decision tree (W3.3), this signals the corpus pair is too ambiguous to gold-lock at all.

Action: discard from gold, log in adjudication-log under "Discarded — FM14", surface in STATUS.md.

Pattern signal: if FM14 count > 5% of corpus, the rubric needs domain-specific examples or the chunk's adjacent_context window is too narrow. Both are rubric-iteration triggers, not run-time fixes.

---

## Adding new FM tags

The rubric is canonical and version-controlled. New tags require:

1. Discovery in a real run (not theoretical).
2. A clear definition + at least one example.
3. A pipeline-side detector OR a judge-side self-tag spec (not both — pick the appropriate layer).
4. Rubric version bump (`v1.1` → `v1.2`) and an entry in `references/prior-runs.md`.

Reserved FM numbers (FM3, FM4, FM5, FM7, FM9, FM10) are pre-allocated for inserting new tags without renumbering. Use them in order before bumping to FM15+.

---

## Provenance

- FM1–FM11 + FM-entity-leak: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-0a-rubric/grading-rubric.md` §8 (Agent A's original audit).
- FM12: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-3-gold/build-gold.py` (pipeline-side detection logic) + `FM-summary.md` footnote.
- FM13: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave3-fm13-liveness.md` (W3.1).
- FM14: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave3-pending-rt.md` (W3.3).
