# The Standing Gold Corpus — 4 frozen domains + bench-run history

> The 4 build-mode runs on 2026-05-15/16 produced the **frozen gold corpus** that the default `/agada-bench` (bench mode) scores live BrainLayer recall against. They are the inputs to the bench, not a history of "past benchmarks."
>
> Below: the 4 standing-corpus domains, followed by any bench-mode run history.

---

## The 4 standing-corpus domains (frozen as gold)

These are the inputs to every default `/agada-bench` run. **Do NOT rebuild casually** — rebuilding breaks the regression-diff chain. Adding a NEW domain via `/agada-bench build` is OK; replacing an existing one is not.

| Domain | Build date | Gold rows | L2+L3 (relevant) | Power tier | Schema |
|---|---|---:|---:|---|---|
| techgym | 2026-05-15 | 58 | 33 | HIGH | v1 (4-way equal-weight) |
| freelance | 2026-05-16 | 53 | 13 | HIGH | v1.1-3p-1s (3p+shadow) |
| recruiting | 2026-05-16 | 47 | 6 | BORDERLINE | v1.1-3p-1s |
| architecture | 2026-05-16 | 40 | 1 | **LOW-POWER** | v1.1-3p-1s |
| **Total** | — | **198** | **53** | — | — |

67 unique queries across the 4 domains. LOW-POWER domains are excluded from cross-domain bench aggregates by default (1 positive sample → recall@K is noise).

---

## Build history (immutable — these built the standing corpus)

Each build below was a one-time creation of a domain's gold. Format:

- **Date**: ISO timestamp (`YYYY-MM-DD HH:MM IDT`).
- **Session**: path to source session JSONL.
- **Output**: path to run output dir.
- **Schema**: v1 | v1.1-3p | v1.1-3p-1s.
- **Judges**: comma-separated panel.
- **Result**: top-line numbers.
- **Verdict**: `GOLD_LOCKED | INCOMPLETE | DISCARDED`.

---

## Builds (chronological, newest first)

### Run 4 — Architecture (2026-05-16)

- **Date**: 2026-05-16 ~early morning IDT
- **Domain**: architecture
- **Session**: `~/.claude/projects/-Users-example-Gits-private-project/<session>.jsonl` (architecture grilling)
- **Output**: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-run-4-architecture/`
- **Rubric**: v1.1, **schema v1.1-3p-1s** (primary={claude,codex,cursor}, shadow={gemini})
- **Judges**: claude, codex, cursor (primary); gemini intended as shadow but structurally absent from row 1 — `shadow_label == {}` on all 40 gold rows.
- **Result**:
  - Gold rows: 40
  - Resolution methods (from gold.jsonl): unanimous-3-primary dominant, some majority-2-primary, 1 discard-FM14
  - Pending-RT: 1
- **Verdict**: GOLD_LOCKED (with FM13 incident noted — gemini structurally absent, motivated W3.1 liveness gate)
- **Notes**: Earlier framing called this "geminiJudge died at s:60 (PTY death)"; empirical re-check on 2026-05-16 showed gemini was never present from row 1 — closer to "never spawned" than "spawned-then-died". Either way the symptom is the same (40/40 rows shadow_label={}), and FM13 catches both. This run motivated FM13 + the liveness gate in v1.

### Run 3 — Recruiting (2026-05-16)

- **Date**: 2026-05-16 ~early morning IDT
- **Domain**: recruiting
- **Session**: `~/.claude/projects/-Users-example-Gits-private-project/<session>.jsonl` (recruiting/interview prep)
- **Output**: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-run-3-recruiting/`
- **Rubric**: v1.1, **schema v1.1-3p-1s** (primary={claude,codex,cursor}, shadow={gemini})
- **Judges**: claude, codex, cursor (primary), gemini (shadow)
- **Result**:
  - Gold rows: 47
  - Pending-RT: 9 (highest of v1.1 runs — motivated W3.3 routing)
- **Verdict**: GOLD_LOCKED
- **Notes**: High pending-RT density was the W3.3 motivation. Most cascade-opus resolved cleanly.

### Run 2 — Freelance (2026-05-16)

- **Date**: 2026-05-16 ~early morning IDT
- **Domain**: freelance
- **Session**: `~/.claude/projects/-Users-example-Gits-private-project/<session>.jsonl` (freelance/contracts)
- **Output**: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-run-2-freelance/`
- **Rubric**: v1.1, **schema v1.1-3p-1s** (primary={claude,codex,cursor}, shadow={gemini})
- **Judges**: claude, codex, cursor (primary), gemini (shadow)
- **Result**:
  - Gold rows: 53
  - Pending-RT: 3
- **Verdict**: GOLD_LOCKED

### Run 1 — TechGym (2026-05-15)

- **Date**: 2026-05-15 ~19:00 IDT
- **Domain**: techgym
- **Session**: `~/.claude/projects/-Users-example-Gits-private-project/example-session.jsonl` (reference session)
- **Output**: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/`
- **Rubric**: v1.1 (newly published; this run was the v1.1 reference), **schema v1** (4-judge equal-weight: {resolution_method, judges_in_agreement, judges_missing, avg_confidence})
- **Judges**: claude, codex, gemini, cursor (all 4 voting equally; no primary/shadow split — that came with Runs 2-4)
- **Result**:
  - Corpus rows: 59 (58 unique + 1 dup pair)
  - Gold rows: 58
  - Resolution methods: 26 unanimous-4, ~17–18 majority, 1 red-team-majority, 18 FM12-judge-integrity-failure (geminiJudge hallucinated off-corpus)
  - FM frequency: FM6 dominant (PreCompact pollution), FM1 (duplicate stubs), FM11 (self-referential echo).
- **Verdict**: GOLD_LOCKED
- **Notes**: First v1.1 reference run. **Regression target** for the skillified `/agada-bench` v1 — re-running on this session should reproduce ≥95% of these gold labels. The original gold lives at `phase-3-gold/gold.jsonl` in the output dir.

---

## Domain validation status

| Domain | Validated? | Builds | Schema | Notes |
|---|:---:|:---:|---|---|
| techgym | ✅ | 1 | v1 | First v1.1 reference rubric; 4-way equal-weight panel; κ(claude,cursor)=0.915 (drop=claude). |
| freelance | ✅ | 1 | v1.1-3p-1s | 3-primary + gemini shadow. |
| recruiting | ✅ | 1 | v1.1-3p-1s | High pending-RT density (motivated W3.3). |
| architecture | ✅ | 1 | v1.1-3p-1s | FM13 incident (gemini structurally absent — 40/40 rows shadow_label={}); motivated W3.1. **LOW-POWER** (only 1 L2+L3 pair). |

---

## Bench-run history (the daily/weekly default mode)

Bench-mode runs score live BrainLayer recall against the frozen gold above. Each run produces `<date>-brainlayer-quality-bench-results.md` + `<date>-bench-summary.json`. The next run passes `--baseline <prior-summary.json>` for regression diff.

| Date | Trigger event | Headline recall@5_true | Placebo rate | Verdict | Report |
|---|---|---:|---:|---|---|
| _(none yet — first bench-mode run pending parent's BL Quality Bench Wave 0+)_ | — | — | — | — | — |

Add entries as bench runs land. Convention: write the report to `$ORCHESTRATOR_ROOT/docs.local/audits/<YYYY-MM-DD>-brainlayer-quality-bench-results.md` and the summary JSON to `<YYYY-MM-DD>-bench-summary.json` in the same dir.

Per `workflows/add-domain.md`, "validated" requires 2 runs on different sessions. After only 1 run each, technically these are "preliminary validation". Re-run any of them via the skillified `/agada-bench` to graduate to full validation.

---

## How to add a new run entry

After `run-agada.sh` exits `GOLD_LOCKED`:

1. Open this file.
2. Add a new heading at the top of `## Runs` with the format above.
3. Pull numbers from `<output>/STATUS.md` (the rollup script writes them).
4. brain_store the chunk: `"agada-bench Run N — <domain>: gold-locked. Corpus N rows. κ̄ X. Output: <path>."` with tags `["agada-bench", "<domain>", "gold-locked"]` and importance ≥ 7.

For a partial/INCOMPLETE run, still add the entry — flag verdict as `INCOMPLETE` with the blocker noted.

---

## Provenance

- v1.1 runs: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/`
- Design doc: `$ORCHESTRATOR_ROOT/docs.local/designs/2026-05-16-agada-bench-as-skill.md`
