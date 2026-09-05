# Workflow: build-new-domain (the `build` subcommand)

> **This is NOT the default `/agada-bench` workflow** — that's `workflows/run-bench.md` (score live BL recall against the existing standing gold). This workflow runs when you're extending the corpus with a new retrieval domain.
>
> Invoked as: `/agada-bench build --session <session.jsonl> --domain <new-domain>`.
>
> Runs the full 7-phase pipeline: session → corpus → judges → liveness gate → crossref → κ → gold-lock → pending-RT routing.

---

## When to use

- A new user-domain becomes important enough to include in the standing bench.
- A representative session JSONL exists for that domain (≥20 brain_search calls is a good target; <10 produces noisy gold).
- You've already run `workflows/add-domain.md` (the dry-run-first methodology) and confirmed the rubric generalizes to this domain.

## When NOT to use

- Default case: scoring live BL recall against the existing gold → use `workflows/run-bench.md`.
- You only need to re-run κ on an existing phase-1 dir → just call `scripts/kappa-matrix.py`.
- You only need to verify a judge is alive → just call `scripts/liveness-check.py`.
- You're tweaking the rubric or reframing a FM tag — those are v2 tasks (see `references/roadmap-v2.md`); don't trigger a rebuild casually.

---

## Inputs

- `--session <path-to-session.jsonl>` — required. Claude Code session transcript.
- `--domain <techgym | freelance | recruiting | architecture | <new>>` — required for output naming.
- `--output <dir>` — required. Convention: `<artifact-dir>/2026-MM-DD-agada-<runlabel>-<domain>/`.
- `--judges <comma-sep>` — default `claude,codex,gemini`.
- Optional overrides (`--rubric-version`, `--liveness-check`, `--pending-rt-cascade`, `--row-tolerance`) — see SKILL.md "Locked decisions".

## Outputs

```
<output>/
├── phase-0a-rubric/grading-rubric.md
├── phase-0b-corpus/{corpus.jsonl, corpus-summary.md, zero-result-queries.jsonl}
├── phase-1-judgments/{claude,codex,gemini}.jsonl + liveness-report.md
├── phase-2-crossref/{disagreement-matrix.md, consensus-draft.jsonl, kappa-matrix.md}
├── phase-3-gold/{gold.jsonl, adjudication-log.md, FM-summary.md, pending-rt-routing.md}
└── STATUS.md
```

The deliverable is `phase-3-gold/gold.jsonl`. Everything else is provenance + diagnostics.

---

## Step-by-step

### Step 0a — copy rubric for provenance

```bash
mkdir -p <output>/phase-0a-rubric
cp $HOME/.golems/skills/golem-powers/agada-bench/references/grading-rubric.md \
   <output>/phase-0a-rubric/grading-rubric.md
```

### Step 0b — extract corpus from session JSONL

```bash
python scripts/extract-corpus.py \
  --session <session.jsonl> \
  --output <output>/phase-0b-corpus/
```

Produces `corpus.jsonl` (one row per `(query_id, chunk_id)` pair surfaced by a `brain_search` call in the session) and `zero-result-queries.jsonl` (queries that returned nothing — these become `missing_expected` candidates).

### Step 1 — dispatch judges

```bash
python scripts/dispatch-judges.py \
  --corpus <output>/phase-0b-corpus/corpus.jsonl \
  --rubric <output>/phase-0a-rubric/grading-rubric.md \
  --judges claude,codex,gemini \
  --output-dir <output>/phase-1-judgments/
```

Spawns N cmux panes per `adapters/<judge>.md`, sends each judge the spawn-brief template with `corpus.jsonl` path + `grading-rubric.md` path interpolated, and polls for each judge's `<judge>.jsonl` to finish writing.

Note: Each judge runs in its own interactive cmux pane. The dispatcher polls but doesn't busy-spin — see `mcp__cmuxlayer__wait_for` usage in `dispatch-judges.py`.

### Step 1.5 — LIVENESS GATE (FM13)

```bash
python scripts/liveness-check.py \
  --phase1-dir <output>/phase-1-judgments/ \
  --corpus <output>/phase-0b-corpus/corpus.jsonl \
  --expected-judges claude,codex,gemini \
  --tolerance 0.05 \
  --strict
```

Pre-Phase-2 gate. Exit codes:
- `0`: all expected judges wrote ≥ (1 - tolerance) of expected rows. Proceed to Phase 2.
- `2`: at least one judge missing or under-quota. **STOP.** Re-run the affected judge before proceeding. Re-running clobbers no other judge's output.

See `workflows/liveness-check.md` for the full FM13 gate spec.

### Step 2 — crossref + consensus draft

```bash
python scripts/build-crossref.py \
  --run-dir <output>/ \
  --judges claude,codex,gemini
```

Produces `phase-2-crossref/disagreement-matrix.md` and `consensus-draft.jsonl`.

### Step 2.5 — κ matrix

```bash
python scripts/kappa-matrix.py \
  --from-phase1 <output>/phase-1-judgments/ \
  --judges claude,codex,gemini \
  --out <output>/phase-2-crossref/kappa-matrix.md \
  --bootstrap-iters 1000
```

Produces Cohen's κ per pair + 95% bootstrap CI. If any pair κ > 0.80 → flag in STATUS.md (judges redundant; consider dropping one for next run).

### Step 3 — gold-lock

```bash
# Default (v1.1-3p — 3 primary, no shadow column; matches the SKILL.md default panel)
python scripts/build-gold.py \
  --run-dir <output>/ \
  --judges claude,codex,gemini \
  --schema v1.1-3p \
  --tiebreaker claude

# 4-way run with gemini as shadow (Runs 2-4 historical)
python scripts/build-gold.py \
  --run-dir <output>/ \
  --judges claude,codex,cursor,gemini \
  --schema v1.1-3p-1s \
  --primary-judges claude,codex,cursor \
  --shadow-judge gemini \
  --tiebreaker claude

# Run 1 reproduction (legacy v1 schema: 4-judge equal-weight)
python scripts/build-gold.py \
  --run-dir <output>/ \
  --judges claude,codex,cursor,gemini \
  --schema v1 \
  --tiebreaker claude
```

Produces `phase-3-gold/{gold.jsonl, adjudication-log.md, FM-summary.md}`.

Rows fall into resolution buckets:
- `unanimous-N`: all N judges agree on a numeric label. Locked.
- `majority-MofN`: clear majority. Locked.
- `tiebreak-claudeJudge`: even split, claudeJudge breaks. Locked.
- `pending-rt`: 3-way disagreement or single-judge outlier on FM6-PreCompact. Routed in Phase 3.5.
- `all-cant-tell-or-empty`: every judge abstained. Discarded with FM-cant-tell tag.

### Step 3.5 — pending-RT routing

```bash
python scripts/route-pending-rt.py \
  --gold <output>/phase-3-gold/gold.jsonl \
  --consensus <output>/phase-2-crossref/consensus-draft.jsonl \
  --cascade opus-4-7 \
  --out <output>/phase-3-gold/pending-rt-routing.md
```

For every `pending-rt` row, the routing decision tree (W3.3) assigns one of:
- `cascade-opus`: single-judge outlier with high agreement among the other two → cheap Opus-4-7 call resolves.
- `etan-adjudicate`: genuine 3-way disagreement with no dominant pattern → human queue.
- `discard-fm14`: fully-distinct labels with spread=3 → corpus pair is too ambiguous to use; tag FM14, drop from gold.

After cascade resolves, `gold.jsonl` is rewritten in place with the resolved labels and `resolution_method` updated to `cascade-opus-resolved` (etc.).

### Step 4 — STATUS.md rollup

`run-agada.sh` auto-writes `<output>/STATUS.md`:

```
verdict: GOLD_LOCKED | INCOMPLETE
session: <path>
domain: <label>
judges: claude,codex,gemini
rubric: v1.1
corpus_rows: 59
gold_rows: 58
resolution_breakdown:
  unanimous-3: 32
  majority-2of3: 15
  tiebreak-claudeJudge: 4
  cascade-opus-resolved: 5
  etan-adjudicate-pending: 1
  discard-fm14: 1
kappa_mean: 0.62
kappa_max_pair: (claude, codex) = 0.78
liveness: PASS
fm_frequency:
  FM1: 12
  FM6: 8
  FM8: 4
  FM11: 3
notes: <free-form>
```

If `verdict: INCOMPLETE`, the run is NOT shippable. Iterate before reporting `TASK_DONE`.

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Judge pane stays at prompt indefinitely | Adapter spawn brief malformed or model unavailable | Inspect via `mcp__cmuxlayer__read_screen`; re-send brief; if model offline, swap judge per `references/judge-panel.md`. |
| Liveness check FAILS for one judge | PTY died mid-run or judge hit context limit | Re-run only the affected judge (others' jsonl untouched); see `workflows/liveness-check.md`. |
| All κ pairs > 0.80 | Judges too redundant (panel needs disjoint family) | Drop the most-redundant judge per kappa-matrix.md; consider swapping a model family. |
| `pending-rt` count > 20% of rows | Domain is genuinely ambiguous OR rubric mismatch for this domain | Stop. Run `workflows/add-domain.md` to design domain-specific examples before re-running. |
| `gold.jsonl` row count < corpus.jsonl row count − 5% | Too many discards from cant-tell + FM14 | Inspect `adjudication-log.md`; consider re-prompting judges with stronger anti-cant-tell guidance. |

---

## Provenance

- FM13 liveness gate, κ-matrix, pending-RT routing, and design provenance live with the private benchmark artifacts configured by the operator.
