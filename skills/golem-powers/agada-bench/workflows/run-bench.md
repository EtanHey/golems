# Workflow: run-bench (the primary `/agada-bench` mode)

> **This is the default `/agada-bench` workflow.** Score live BrainLayer recall against the standing gold corpus (the 4 frozen domains: techgym, freelance, recruiting, architecture). Use after any BrainLayer change to detect regressions or confirm improvements.

---

## When to use

- After any PR merges into BrainLayer (e.g., PR A FM6 PreCompact fix lands).
- After enrichment schema changes (e.g., R81 ships).
- Periodically (weekly/biweekly) to track drift.
- After a model swap or embedder version bump.

## When NOT to use

- You're adding a new user-domain. Use `/agada-bench build --session X --domain Y` instead — see `workflows/build-new-domain.md`.
- You want to tweak the rubric. The rubric is frozen at v1.1; iterating it is a v2 task (see `references/roadmap-v2.md`).
- You need a one-off, single-query smoke. Just call brain_search directly.

---

## Discipline upfront — three Wave-0 patterns to respect

### 1. CHUNKED-WRITE (W0 #1)

Long `write_file` calls timeout at ~4 min when writing 12K+ payloads. Any report > 2KB must be:

- Split into ≤2KB segments, OR
- Built via append-mode (write first 2KB, then `append_chunked` each subsequent block).

`scripts/run-bench.py score` does this automatically via `append_chunked(out_path, text)` at every section boundary. Don't override — if you write the report yourself, use the same pattern.

### 2. QUERY RECONSTRUCTION (W0 #2)

`gold.jsonl` does NOT carry the verbatim `brain_search` args (only `query_id` + `chunk_id` + `gold_label`). To reconstruct queries:

- Read each domain's `phase-0b-corpus/corpus.jsonl` — it carries `query_text`, `query_filters` (`tag`, `num_results`), and `query_intent_hint`.
- Build a `{query_id → args}` index BEFORE any live `brain_search` call.

`scripts/run-bench.py prepare` does this automatically. The output `bench-queries.jsonl` carries verbatim args per query.

### 3. RUN 4 LOW-POWER (W0 #3)

The architecture domain's gold has 40 rows but only **1 L2+L3-labeled pair** (the rest are 0 or 1). Recall@K is statistically meaningless on a single positive sample.

`run-bench.py score` flags architecture as `low_power: true` in meta and **excludes it from cross-domain aggregates by default**. Pass `--include-low-power` only when you specifically want to see architecture's numbers (knowing they're noisy).

---

## Inputs (the standing gold corpus)

Four frozen gold corpora (built once during the 2026-05-15/16 build sprint; treat as immutable):

```
<gold-root>/techgym/phase-3-gold/gold.jsonl      # techgym, 58 pairs, L2+L3=33 (HIGH-POWER)
<gold-root>/freelance/phase-3-gold/gold.jsonl    # freelance, 53 pairs, L2+L3=13 (HIGH-POWER)
<gold-root>/recruiting/phase-3-gold/gold.jsonl   # recruiting, 47 pairs, L2+L3=6 (BORDERLINE)
<gold-root>/architecture/phase-3-gold/gold.jsonl # architecture, 40 pairs, L2+L3=1 (LOW-POWER)
```

Total: 198 gold pairs, 67 unique queries, 53 L2+L3 (relevant) pairs.

Verbatim args sourced from each domain's `phase-0b-corpus/corpus.jsonl` (same parent dir).

---

## The 6-wave procedure

### Wave 0 — Prepare

```bash
python3 scripts/run-bench.py prepare \
  --gold techgym:<gold-root>/techgym/phase-3-gold/gold.jsonl \
  --gold freelance:<gold-root>/freelance/phase-3-gold/gold.jsonl \
  --gold recruiting:<gold-root>/recruiting/phase-3-gold/gold.jsonl \
  --gold architecture:<gold-root>/architecture/phase-3-gold/gold.jsonl \
  --output <output-dir>/bench-queries.jsonl
```

Produces `bench-queries.jsonl` — one `_meta` row + 67 query rows, each with verbatim `query_text` + `query_filters` + `expected_gold` (the gold rows for that qid).

### Wave 1 — Baseline recall@K curve per domain (live brain_search)

For each row in `bench-queries.jsonl`:

1. Fire the live `brain_search(query=row.query_text, **row.query_filters, num_results=50)` via MCP.
2. For each returned chunk, classify provenance (see §Anti-placebo below):
   - `true_hit` — chunk existed before the original query; not session-echoed.
   - `echo_fm11` — chunk created in same session as query (auto-summarizer echo).
   - `downstream` — chunk is a result of someone reading prior recall + storing it.
   - `uncertain` — can't tell.
   - `metadata_gap` — `chunk_created_iso` / `source_session_id` missing.
3. Append one row per returned chunk to `bench-results.jsonl`:
   ```json
   {"domain":"techgym","query_id":1,"position":1,"chunk_id":"rt-0c2e3cb8-","chunk_created_iso":"2026-04-09T11:24:49Z","source_session_id":"...","provenance":"true_hit","score":28.85,"imp":2}
   ```

This is where the Claude/Codex operator session does the real work. Python can't reach the BL MCP.

### Wave 2 — Paraphrase + sub-query expansion (FM2 surface)

For each query, generate 3 paraphrase variants + 2 sub-queries:

- **Paraphrase variants**: e.g., "coach handoff pending items" → "what's outstanding for next coach session?" / "incomplete coach work items" / "coach session backlog".
- **Sub-queries**: narrow slices, e.g., "TechGym Cohort 5 lecture title abstract Sagit" → "TechGym lecture title" / "Sagit BrainLayer lecture".

Re-run brain_search per variant. Track:
- `paraphrase_recall_consistency` — fraction of gold chunks appearing in BOTH original AND ≥1 paraphrase result.
- `paraphrase_unique_recall` — gold chunks surfaced ONLY in paraphrase variants (BrainLayer needed help).

Append variant results to the same `bench-results.jsonl` with an extra `variant: "paraphrase-1" | "sub-query-1" | ...` field.

### Wave 3 — Deep recall + cross-domain bleed

For each query: `brain_search(num_results=100)`.

- **Deep recall**: do gold chunks ever surface in 50–100? If yes, ranking problem, not recall problem.
- **Cross-domain bleed**: re-run each query WITHOUT the domain tag. Compare top-10. `cross_domain_leak_rate` = fraction of top-10 from non-target domains when the original was tag-filtered.

### Wave 4 — Failure-mode stress test

For each FM in {FM1, FM2, FM6, FM8, FM11}, design 5 synthetic stress queries designed to trigger it. Examples:

- **FM6** (PreCompact pollution): queries that should NOT return PreCompact checkpoints but might because of session-vocabulary overlap. A prior benchmark found the trigger rate rising across consecutive runs. Confirm whether it regresses or improves versus the configured baseline.
- **FM11** (echo): issue a brand-new query BL has never seen → wait 2 minutes → re-query. Did the second call return a chunk created by the first? Measure FM11 trigger rate.
- **FM2** (paraphrase miss): pick 5 queries where recall@5 was 0. Try 10 rephrasings each. Track which ones unlock the gold.
- **FM1** (duplicate stubs): for any query returning ≥3 identical-content chunks, count duplicates.
- **FM8** (imp inversion): scan top-10 of all queries — count `imp:0` chunks appearing above `imp:5+`.

Output per-FM trigger rate.

### Wave 5 — Regression diff vs prior baseline

Run `run-bench.py score` with `--baseline <prior-summary.json>`. Outputs per-metric Δ.

Candidate prior baselines:
- A pre-change audit in the configured artifact directory.
- A prior phase audit in the configured artifact directory.
- Any prior `<date>-brainlayer-quality-bench-results.md` from this skill's own past runs.

Surface:
- **Regression list** — queries where recall@5 went DOWN since baseline.
- **Improvement list** — queries where recall@5 went UP since baseline.
- **Per-FM trigger rate diff** — has FM6 dropped after PR A merged? Has FM11 climbed because of new placebo sources?

### Wave 6 — Open-ended dig (operator-driven)

Pick the 5 most surprising or alarming findings from Waves 1–5. For each, design 1–2 follow-up brain_searches to dig deeper. Examples:

- FM6 trigger rate exceeded baseline → run 20 more PreCompact stress queries.
- A specific domain regressed 50%+ → identify chunk-deletion vs ranking drift.
- `imp:0` outranking `imp:7+` (FM8) → fetch top-100 highest-score chunks across all queries; what fraction are `imp:0`?

Append findings to the report manually (chunked-write).

---

## Score + report

```bash
python3 scripts/run-bench.py score \
  --queries <output-dir>/bench-queries.jsonl \
  --results <output-dir>/bench-results.jsonl \
  --output <output-dir>/<date>-brainlayer-quality-bench-results.md \
  --json-out <output-dir>/<date>-bench-summary.json \
  --baseline <prior-summary.json>            # optional, enables regression diff
  --k 1,3,5,10,20,50                          # default
  # --include-low-power                       # only if you want architecture in the overall
```

Output structure (chunked-write per W0 #1):

```
<date>-brainlayer-quality-bench-results.md
├── Overall (excluding LOW-POWER domains by default)
├── Regression diff vs baseline (if --baseline given)
├── Per-domain breakdown (each domain flagged LOW-POWER where applicable)
└── Per-query detail (recall@5_true/inflated, MRR_true, precision@5, placebo_rate)
```

Plus `<date>-bench-summary.json` with `{overall, by_domain, baseline_diff, meta, k_values, include_low_power}` — used as the `--baseline` for the NEXT run.

---

## Anti-placebo classification (mandatory)

Per `/never-fabricate`, every returned chunk in `bench-results.jsonl` must carry a `provenance` tag. Use this checklist:

```
1. chunk.created_at < query.original_asked_at?               → could be true_hit
2. chunk.source_session_id == query.original_session_id?     → echo_fm11
3. chunk.content paraphrases query.text (>40% overlap)?      → echo_fm11
4. chunk was a brain_store from this audit's own runs?       → downstream
5. chunk's source is a previous audit doc?                    → downstream
6. None of the above + clearly answers the query?             → true_hit
7. Ambiguous?                                                 → uncertain
8. Can't determine created_at / source_session_id?            → metadata_gap (= a separate finding)
```

The `run-bench.py score` function honors the `provenance` field verbatim. Mis-classification at this layer poisons every downstream metric — be conservative; when in doubt, mark `uncertain` rather than `true_hit`.

---

## Known-pattern notes (from Wave 0 / earlier mining)

- **FM6 PreCompact monotonic regression** (11 → 19 → 22 → 26 across Runs 1–4 = 39.4% of pairs) — single most urgent BL quality issue. Track FM6 rate explicitly per run; trend should reverse after PR A merges.
- **FM14 schema visibility**: FM14 (fully-distinct-spread-3) is only visible in v1 schema (Run 1). In v1.1-3p / v1.1-3p-1s, the 3-primary collapse makes 4-way FM14 structurally invisible. Don't conclude "FM14 disappeared in newer runs" — it's just unreported by design.
- **codex-as-outlier in pending-RT**: 12 of 13 pending-RT cases across all runs have codex as the lone outlier (typically on FM6-PreCompact). The W3.3 cascade-to-opus default resolves these cheaply.

---

## Manual output target

By convention, write the report to:

```
<artifact-dir>/<YYYY-MM-DD>-brainlayer-quality-bench-results.md
```

(The driver `run-agada.sh` defaults to this location.)

After report writes, also `brain_store` a TASK_DONE chunk with:

```
- Top-line recall@5_true (overall, low-power excluded)
- Placebo rate
- Top 3 regressions vs baseline
- Top 3 improvements vs baseline
- FM6 trigger rate (the headline metric)
- Verdict: GREEN (>80% recall@5_true) / YELLOW (60-80%) / RED (<60%)
```

Tag with `["agada-bench", "bench-run", "<YYYY-MM-DD>", "post-<event>"]` where `<event>` is the recent BL change being benchmarked (e.g., `post-pr-A-merge`, `post-r81-enrich`).

---

## Composability

This workflow is referenced by:
- `SKILL.md` (the default mode).
- `scripts/run-agada.sh` (top-level driver).

This workflow references:
- `references/grading-rubric.md` — v1.1 frozen rubric used by the standing gold.
- `references/failure-modes.md` — FM1–FM14 catalog.
- `references/prior-runs.md` — index of the 4 standing-corpus domains.
- `/never-fabricate` — every returned chunk MUST carry a provenance tag.

---

## Provenance

- The original research prompt is private; this workflow is the public, executable specification.
- Wave 0 findings durable in BrainLayer under tag `wave-0-complete`.
- Course-correction provenance is retained with the private benchmark artifacts.
