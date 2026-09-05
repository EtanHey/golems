# Workflow: liveness-check (FM13 gate)

> Pre-Phase-2 validation that every expected judge actually wrote its rows. Closes the silent-gemini-death hole from Run 4.

---

## Why this exists

In Run 4 (Architecture domain), `geminiJudge` died silently mid-run (s:60 PTY/auth death). The downstream `build-crossref.py` had no liveness check — it cheerfully iterated over the JSONLs it found, produced a "3-primary" consensus, and the gold corpus shipped with the gemini column quietly empty. Nobody noticed until the κ matrix surfaced suspicious 3-judge correlation patterns post-hoc.

W3.1's resolution: a pre-lock gate that explicitly counts each expected judge's rows and FAILS LOUD if any judge is under-quota.

---

## What "alive" means

A judge is alive on a corpus C iff:

1. `phase-1-judgments/<judge>.jsonl` exists and is readable as JSONL.
2. The judge wrote at least `(1 - tolerance) × |C|` distinct `(query_id, chunk_id)` rows that exist in `corpus.jsonl`.
3. No more than `tolerance × |C|` of the judge's rows are off-corpus (FM12 hallucinations).

`tolerance` defaults to `0.05` (5% slack — allows 1–2 trailing rows lost to CLI hiccup). For final gold-lock, tighten to `0.0`.

---

## The gate

```bash
python scripts/liveness-check.py \
  --phase1-dir <output>/phase-1-judgments/ \
  --corpus <output>/phase-0b-corpus/corpus.jsonl \
  --expected-judges claude,codex,gemini \
  --tolerance 0.05 \
  --strict
```

Exit codes:
| Code | Meaning | Caller action |
|---|---|---|
| `0` | All expected judges alive within tolerance. | Proceed to Phase 2. |
| `2` | At least one judge missing or under-quota. | STOP. Re-run the affected judge(s). |
| `3` | At least one judge has too many off-corpus rows (judge-integrity FM12 failure). | STOP. Investigate the judge — likely model misalignment or rubric drift. |

`--strict` flag turns warnings (e.g., excessive cant-tell rate, judge silent on a corpus subset) into exit 2. Default mode emits warnings to stderr but exits 0 if the basic row-count gate passes.

---

## What the report looks like

```markdown
# Liveness Report — phase-1-judgments/

Corpus: 59 (query_id, chunk_id) pairs from phase-0b-corpus/corpus.jsonl
Expected judges: claude, codex, gemini
Tolerance: 5%
Mode: strict

## Per-judge

| Judge | Rows written | Rows in corpus | Off-corpus | % of corpus | Status |
|---|---:|---:|---:|---:|---|
| claudeJudge | 59 | 59 | 0 | 100.0% | ✅ ALIVE |
| codexJudge  | 59 | 59 | 0 | 100.0% | ✅ ALIVE |
| geminiJudge | 41 | 41 | 18 | 69.5% | ❌ DEAD (under quota: 41/56 = 69%, below 95%) |

## Verdict

❌ FAIL — geminiJudge below the 95% liveness threshold.

## Action required

Re-run geminiJudge against `phase-0b-corpus/corpus.jsonl` writing to
`phase-1-judgments/gemini.jsonl`. The other judges' outputs are unaffected.
Once gemini writes ≥56 corpus-aligned rows, re-run liveness-check.
```

---

## How to re-run just one judge

```bash
# Single-judge dispatch (skip the others)
python scripts/dispatch-judges.py \
  --corpus <output>/phase-0b-corpus/corpus.jsonl \
  --rubric <output>/phase-0a-rubric/grading-rubric.md \
  --judges gemini \
  --output-dir <output>/phase-1-judgments/ \
  --resume
```

`--resume` makes dispatch-judges skip judges whose `<judge>.jsonl` already passes liveness; for the failing judge, it `mv`s the old file to `<judge>.jsonl.dead-<timestamp>` and re-dispatches fresh.

---

## What "off-corpus" means and why it kills the gate

A row `(query_id=5, chunk_id="rt-abc...")` is off-corpus if `(5, "rt-abc...")` is NOT in `corpus.jsonl`. This means the judge graded a chunk that wasn't in the corpus row for that query — typically because:

1. The judge hallucinated a chunk_id from context (FM12-hallucinate).
2. The judge mis-aligned rows (graded query 5's chunks against query 6's chunk_id list).
3. The judge ran on a stale corpus.

Either way, the gold-lock pipeline can't use the row — it has no consensus pair to align with. FM12 hallucinations are tagged + discarded in build-gold.py, but liveness-check.py refuses to proceed if their rate exceeds tolerance because the judge is structurally unreliable.

---

## Tolerance tuning

| Phase | Recommended tolerance |
|---|---|
| Smoke / dogfood | `0.05` (5% slack) |
| Production gold-lock | `0.0` (strict) |
| Replay / reproducibility against historical Run N | `0.05` |
| Cross-domain bench (multi-domain sweep) | `0.05` |

Higher than `0.10` is suspicious. If a judge can only hit 80–90% of the corpus, the spawn brief or rubric needs work — re-running with the same setup will reproduce the gap.

---

## Composability

This gate is referenced by:
- `workflows/full-sweep.md` (Phase 1.5)
- `scripts/run-agada.sh` (between dispatch-judges and build-crossref)

It can be invoked standalone for debugging when a judge silently died mid-run.

---

## Provenance

- W3.1 design: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave3-fm13-liveness.md`
- Original incident: Run 4 (Architecture), s:60 geminiJudge PTY death (2026-05-15)
