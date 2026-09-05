---
name: agada-bench
description: "BrainLayer retrieval benchmark: recall@K, MRR, p@5, placebo. Triggers: agada bench, BL PR, embedder swap."
---

# /agada-bench — Standing BrainLayer Quality Benchmark

> Score live BrainLayer recall against the frozen 4-domain gold corpus. Run whenever BrainLayer changes (PR merges, FM fixes ship, enrichment updates) to detect regressions or confirm improvements.

## The Mission

```
MISSION = a regression/improvement scorecard for the current BrainLayer build.
Not "ran some brain_search calls." Not "produced numbers."
Done = bench-report.md exists + per-domain breakdown + regression diff vs prior baseline + brain_store TASK_DONE.
```

Anything short of a complete scorecard with provenance-tagged hits is a partial run — flag it loudly, don't summarize over it.

---

## Two modes

### Mode 1 (default) — `/agada-bench` runs the bench

Score live BL recall against the standing gold. Use this 95% of the time. Triggers: post-PR-merge audit, weekly drift check, post-enrichment-schema-change verification, post-embedder-swap regression sweep.

See `workflows/run-bench.md` for the 6-wave procedure.

### Mode 2 (rare subcommand) — `/agada-bench build` extends the standing corpus

Add a new user-domain to the frozen gold when a distinct retrieval topic becomes important enough to benchmark. Spawns 3 judges in cmux panes and runs the full 7-phase build pipeline.

See `workflows/build-new-domain.md` for the build pipeline.

---

## What is and isn't

| Is | Isn't |
|---|---|
| The standing scorecard for BrainLayer health. | A one-off query test. Just call brain_search yourself. |
| Anti-placebo (every hit is classified true_hit / echo_fm11 / downstream / uncertain / metadata_gap). | A vanilla recall@K calculator. Provenance matters more than the number. |
| Frozen gold: 4 domains × 67 queries × 198 pairs (53 L2+L3 relevant). | A flexible-rubric eval. Rubric is v1.1 locked. |
| Regression-diff-aware (compare vs prior bench summary JSON). | A trend monitor. Each run produces its summary; the operator chains them by passing `--baseline`. |
| Operates with Python helper + Claude/Codex session driving live brain_search via MCP. | A pure CLI tool. Python can't reach the MCP; live calls happen in the operator's session. |

---

## Invocation

### Bench mode (default)

```bash
# Run-anywhere invocation from a Claude/Codex session with BL MCP
/agada-bench

# Score only a subset of domains (e.g., skip architecture's LOW-POWER noise explicitly)
/agada-bench --domains techgym,freelance,recruiting

# With baseline for regression diff
/agada-bench --baseline <artifact-dir>/previous-bench-summary.json

# Custom output dir + K values
/agada-bench --output-dir <artifact-dir>/ --k 1,3,5,10,20,50

# Include LOW-POWER architecture in aggregates (default: excluded)
/agada-bench --include-low-power
```

What the skill does under the hood:

1. `scripts/run-bench.py prepare` loads the 4 frozen gold paths + each domain's `phase-0b-corpus/corpus.jsonl` → emits `bench-queries.jsonl` with 67 queries + verbatim brain_search args.
2. Operator (Claude/Codex session) reads `workflows/run-bench.md` and executes Waves 1–6: fires live brain_search per query, classifies each returned chunk for provenance (anti-placebo), appends to `bench-results.jsonl`.
3. `scripts/run-bench.py score` reads results, computes recall@K / MRR / precision@5 / placebo rate / regression diff → emits `<date>-brainlayer-quality-bench-results.md` + `<date>-bench-summary.json`.
4. brain_store TASK_DONE chunk with headline metrics + verdict.

### Build mode (rare subcommand)

```bash
# Add a new domain to the standing corpus
/agada-bench build --session ~/.claude/projects/.../<new-session>.jsonl --domain health-whoop

# With 4-way panel (Runs 2-4 historical setup)
/agada-bench build \
  --session <jsonl> \
  --domain family \
  --judges claude,codex,cursor,gemini \
  --schema v1.1-3p-1s \
  --primary-judges claude,codex,cursor \
  --shadow-judge gemini
```

See `workflows/build-new-domain.md` for the full 7-phase build pipeline (corpus extract → judge dispatch → liveness gate → crossref → κ → gold-lock → pending-RT).

---

## The standing gold corpus (4 frozen domains)

| Domain | Gold rows | L2+L3 pairs | Power | Source |
|---|---:|---:|---|---|
| techgym | 58 | 33 | HIGH | `<gold-root>/techgym/phase-3-gold/gold.jsonl` |
| freelance | 53 | 13 | HIGH | `<gold-root>/freelance/phase-3-gold/gold.jsonl` |
| recruiting | 47 | 6 | BORDERLINE | `<gold-root>/recruiting/phase-3-gold/gold.jsonl` |
| architecture | 40 | 1 | **LOW-POWER** | `<gold-root>/architecture/phase-3-gold/gold.jsonl` |
| **Total** | **198** | **53** | — | 67 unique queries |

LOW-POWER means recall@K is statistically meaningless on that domain (single positive sample). Excluded from cross-domain aggregates by default.

Verbatim brain_search args live in each domain's `phase-0b-corpus/corpus.jsonl` (sibling dir of gold). See `references/prior-runs.md` for the full provenance.

---

## Locked decisions (bench mode)

| Setting | Default | Why | Override condition |
|---|---|---|---|
| Domains | all 4 | Most representative spread. | `--domains` to subset; useful when isolating a single-domain regression. |
| LOW-POWER inclusion | excluded | Run 4 (architecture) has L2+L3=1 → recall@K noise dominates. | `--include-low-power` only when specifically auditing architecture. |
| K values | `1,3,5,10,20,50` | Standard IR eval set. | `--k` to override. |
| Anti-placebo | mandatory | All BL retrievals must be classified (true_hit / echo_fm11 / downstream / uncertain / metadata_gap). | Cannot disable. Skipping placebo classification = corrupt scorecard. |
| Rubric | v1.1 frozen | Tonight's gold uses v1.1. Don't iterate. | v2 trigger (see `references/roadmap-v2.md`). |
| brain_store on completion | yes | TASK_DONE chunk with headline metrics. | `--no-store` for dry-run smokes. |

---

## Locked decisions (build mode)

When extending the standing corpus with a new domain, the same defaults from v1 build apply:

| Setting | Default | Why |
|---|---|---|
| `--judges` | `claude,codex,gemini` (3) | W3.2 κ matrix — codex is most independent voter; cursor most redundant with claude (κ=0.811 on Runs 2-4 avg / 0.915 on Run 1 alone). |
| `--schema` | `v1.1-3p` (3 primary, no shadow) | Matches the default 3-judge panel; cleaner than the 3-primary-+-1-shadow split. |
| `--rubric-version` | `v1.1` | FM12 = 0/145 in production. |
| `--liveness-check` | `strict` (≥95% rows, fail-loud, exit 2) | Closes W3.1's silent-gemini-absent hole from Run 4. |
| `--pending-rt-cascade` | `opus-4-7` | W3.3: 12 of 13 v1.1 pending-RT cases are FM6-PreCompact single-judge outliers; cheap Opus resolves. |
| Tiebreaker | `claudeJudge` | Cleanest calibration (mean 86.6); 0 hallucinations on Runs 2/3/4. |

See `references/judge-panel.md` for the full κ rationale.

---

## When to use bench mode

- **After ANY BrainLayer change** that could affect retrieval (PR merges, schema updates, embedder swaps, FM fixes shipping).
- **Periodic drift checks** (weekly / biweekly) even when nothing visible changed — to catch silent regressions.
- **Pre-flight before a major BL refactor** — establish the baseline summary that future runs compare against.

## When NOT to use bench mode

- One-off "does brain_search work" check — just call brain_search directly.
- Domain-specific deep-dive that doesn't need the full 198-pair corpus — use `brain_search` ad-hoc.
- Testing a non-BrainLayer retrieval system — agada-bench is BL-specific.

## When to use build mode

- A new user-domain has emerged. Build a fresh ~50-row gold corpus so the bench can score recall on it.
- A domain's source session is replaceable with a much-better representative session (rare — usually we add a new domain rather than rebuild an old one).

## When NOT to use build mode

- The 4 existing domains cover your audit need — just run bench mode.
- You're tempted to "rebuild techgym with a fresher session." The standing gold is frozen for a reason — rebuilding breaks the prior-baseline regression chain.
- You're tempted to iterate the rubric. Don't. That's a v2 task.

---

## v1 known limitations (deferred to v2)

### Build-mode limits (from extract-corpus.py)

Auto-extraction from session JSONL only has access to what BL renders in the brain_search tool_result text:

1. **chunk_id is a BL-rendered prefix** (e.g., `rt-0c2e3cb8-`), not the full chunk_id. Tonight's hand-curated runs used a live BL DB lookup to resolve prefixes; v1 doesn't.
2. **chunk_full_content is BL's one-line truncation**, not the verbatim chunk body. Judges grade based on this truncation.
3. **adjacent_chunks is always empty** — surfacing neighbors requires a live DB lookup.

All gated by the same fix: extract-corpus.py needs a live `brain_recall(chunk_id_prefix)` lookup to resolve prefixes and pull full bodies. That's a v2 task; see `references/roadmap-v2.md` Phase A.5.

### Bench-mode limits (from run-bench.py)

1. **Python can't call MCP** — live brain_search must happen in the operator's Claude/Codex session.
2. **Anti-placebo classification is operator-driven** — relies on the operator inspecting chunk_created_iso and source_session_id per the checklist in `workflows/run-bench.md`. Errors here corrupt every downstream metric.
3. **Run 4 LOW-POWER**: architecture (1 L2+L3 pair) is excluded from aggregates by default. Acceptable for v1; v2 may rebuild architecture with a richer source session.

---

## v2 roadmap (deferred, documented)

Per W1.7's skeptical pass, v1.1 is SHIP. v2 triggers only when the flip conditions in `references/roadmap-v2.md` fire (FM12 > 0 on any run, second judge dies, etc.). v2 buildout sketches:

- Phase A: Platt-scale verbalized confidence + per-domain calibration (W1.1 + W1.3)
- Phase A.5: chunk_id-prefix-to-full resolution via live `brain_recall` (extract-corpus.py limitation)
- Phase B: Abstention τ=0.55 + risk-coverage curve (W1.5)
- Phase C: Reasoning-tree audit module (W1.2 ADOPT-LITE)
- Phase D: Production-modal hardening (W1.6 applicable subset)

---

## Composability

This skill is referenced by:
- `/orc` — when sweeping multi-domain regressions.
- The post-PR-merge ritual after BrainLayer PRs land.

This skill references:
- `/never-fabricate` — anti-placebo classification is mandatory; no "true_hit" without verified `chunk_created_iso` vs `query_asked_at`.
- `/cmux-agents` — only build mode uses cmux pane spawn (for judge dispatch); bench mode runs entirely in the operator's session.
- the false-green-gate hook — bench-report.md verdict must say `GREEN | YELLOW | RED` based on actual numbers, not approximations.

---

## Quick reference

### Bench mode (default — the daily-use case)

```bash
# Run inside a Claude/Codex session with BL MCP connected
python3 "$GOLEMS_ROOT/skills/golem-powers/agada-bench/scripts/run-bench.py" prepare \
  --gold techgym:<gold-root>/techgym/phase-3-gold/gold.jsonl \
  --gold freelance:<gold-root>/freelance/phase-3-gold/gold.jsonl \
  --gold recruiting:<gold-root>/recruiting/phase-3-gold/gold.jsonl \
  --gold architecture:<gold-root>/architecture/phase-3-gold/gold.jsonl \
  --output <artifact-dir>/$(date +%Y-%m-%d)-bench-queries.jsonl

# Operator: read workflows/run-bench.md, do the 6 waves of brain_search, write bench-results.jsonl

python3 "$GOLEMS_ROOT/skills/golem-powers/agada-bench/scripts/run-bench.py" score \
  --queries <artifact-dir>/$(date +%Y-%m-%d)-bench-queries.jsonl \
  --results <artifact-dir>/$(date +%Y-%m-%d)-bench-results.jsonl \
  --output <artifact-dir>/$(date +%Y-%m-%d)-brainlayer-quality-bench-results.md \
  --json-out <artifact-dir>/$(date +%Y-%m-%d)-bench-summary.json \
  --baseline <previous-summary.json>
```

Or via the top-level driver:

```bash
bash "$GOLEMS_ROOT/skills/golem-powers/agada-bench/scripts/run-agada.sh"
```

### Build mode (rare subcommand)

```bash
# Add a new domain (run once per new domain — a few times a year)
bash "$GOLEMS_ROOT/skills/golem-powers/agada-bench/scripts/run-agada.sh" build \
  --session <new-domain-session.jsonl> \
  --domain <new-domain-name> \
  --output <artifact-dir>/2026-MM-DD-agada-<new-domain>/
```

### Prior runs index

See `references/prior-runs.md` for the 4 standing-corpus domains and the dates they were locked.

*End SKILL.md. Primary workflow: `workflows/run-bench.md`. Build workflow: `workflows/build-new-domain.md`. Per-judge briefs: `adapters/`. Standing-gold provenance: `references/prior-runs.md`.*
