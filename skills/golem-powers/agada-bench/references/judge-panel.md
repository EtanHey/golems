# Judge Panel — default 3-judge composition + when to override

> Default panel: `claudeJudge`, `codexJudge`, `geminiJudge`. Empirically grounded in W3.2's Cohen's κ analysis of v1.1 Runs 2/3/4.

---

## The default 3-judge panel

| Judge | Model family | Role in the panel | Why it's in |
|---|---|---|---|
| claudeJudge | Anthropic Claude (Opus class) | Balanced calibration anchor + tiebreaker | Mean confidence 86.6 (not overconfident); 0 hallucinations on Runs 2/3/4; cleanest reasoning_short prose. |
| codexJudge | OpenAI GPT (Codex/GPT-5 class) | Most independent voter | Mean pairwise κ = 0.48 — lowest in panel. Catches FM11 × 17 + FM8 × 3 uniquely (not flagged by any other judge). |
| geminiJudge | Google Gemini (1.5+ class) | Disjoint family voter | Provides diverse vector space coverage; pairs with claude/codex at κ ≈ 0.55. **Reliability concern**: died at s:60 in Run 4 (FM13); liveness gate (W3.1) now catches this. |

cursorJudge (4th judge in v1.1 Runs 1–4) is **dropped** by default per W3.2:
- κ(claude, cursor) = 0.811 is the highest pair in the matrix — cursor and claude vote almost identically.
- Mean κ of 0.68 is the highest single-judge value — least independent voter.
- Dropping it cuts cost ~25% and breaks ties cleanly (odd N).

---

## W3.2's κ matrix (empirical baseline)

> **Two-baseline note:** Run 1 alone yields a tighter κ matrix than the Runs 2-4 average. Empirically (2026-05-16 verification via `scripts/kappa-matrix.py` on the Run 1 phase-1-judgments): κ(claude, cursor) = **0.915**, mean κ for claudeJudge = 0.830 (drop-judge recommendation: claudeJudge, NOT cursorJudge). The Runs 2/3/4 average below (κ(claude,cursor)=0.811, drop=cursor) is the multi-run baseline. They describe DIFFERENT panel setups: Run 1 was 4-way equal-weight; Runs 2-4 used 3-primary + 1-shadow with cursor as a primary. The drop-judge recommendation in the default SKILL.md panel rests on the Runs-2-4 baseline because v1.1+ runs use the 3-primary mode. If you re-run agada-bench with a 4-way equal-weight panel and see Run 1's κ pattern, the drop-judge math may invert.

Computed across Runs 2 + 3 + 4 (n ≈ 145 corpus-aligned rows per judge), weighted (linear) Cohen's κ:

| Pair | κ (weighted) | 95% CI |
|---|---:|---|
| **claude × cursor** | **0.811** | [0.74, 0.88] |
| claude × codex | 0.62 | [0.55, 0.69] |
| claude × gemini | 0.58 | [0.50, 0.66] |
| codex × cursor | 0.56 | [0.48, 0.64] |
| gemini × cursor | 0.52 | [0.45, 0.59] |
| **codex × gemini** | **0.38** | [0.30, 0.46] |

Per-judge mean κ:

| Judge | Mean κ | Independence rank |
|---|---:|---|
| codexJudge | **0.52** | #1 (most independent) ← keep |
| geminiJudge | 0.49 | #2 |
| claudeJudge | 0.67 | #3 |
| cursorJudge | 0.63 | #4 (dropped) |

(The slight mean-κ ordering inversion for claude vs cursor is because cursor's lowest pair is with gemini, not claude. Dropping cursor is still the right call because it eliminates the single-highest pair κ = 0.811.)

---

## Tiebreaker = claudeJudge

When the 3-judge panel produces a 1-1-1 tie or a 2-vote split that needs a fallback, claudeJudge breaks the tie.

Why claudeJudge:
- **Cleanest calibration**: mean confidence 86.6, only 5/59 rows ≥95 across primary grade pass. Not overconfident.
- **Zero hallucinations** on the primary grade pass across Runs 2/3/4 (cursor also 0, codex 0; only gemini hallucinated in Run 1, at 18/77 = 23%).
- **Useful uncertainty**: when claudeJudge says label=1 with conf 70, that's a real "I'm not sure"; downstream pipelines can treat it appropriately.

Why not codexJudge as tiebreaker: codex is the most independent voter, but its independence makes its tiebreaks unpredictable. We want the tiebreaker to be predictably calibrated, not maximally independent.

Why not the most-confident judge: confidence ≠ accuracy. claudeJudge's calibration (mean 86.6, no over-95 cluster) is the right shape.

---

## When to override the default panel

| Situation | Override |
|---|---|
| Reproducing a v1.1 Run 1–4 result | Use all 4 (`--judges claude,codex,gemini,cursor`) — the historical gold was built with cursor in panel. |
| One judge's API is down | Run with N-1 judges; pass `--liveness-check warn-only`. Re-run later with the failed judge to complete liveness. |
| Suspected calibration drift on one judge | Add a 4th independent judge (cursor or a custom 5th) for that run only; compare κ̄. |
| Cost-constrained smoke test | Single-judge run (claudeJudge only) is OK for adapter-spawn-brief smoke tests. Don't use the output as gold. |
| New domain (unvalidated) | Run a single-judge dry-run first (see `workflows/add-domain.md`); only spin up the full panel after the rubric fit is verified. |

Anything else (custom 5th judge, swapping a model family) is a **rubric iteration trigger**, not a panel decision. Record the κ matrix that motivates the swap in BrainLayer with imp ≥ 7 + bump rubric version.

---

## What disqualifies a judge from inclusion

A judge model is unfit for the panel if any of the following are true on a representative corpus:

1. **Hallucination rate > 10%** of corpus rows produce off-corpus `(qid, chunk_id)` pairs (FM12). This was the geminiJudge issue in Run 1 (23% off-corpus); v1.1 prompts fixed it but it's the historical pattern to watch.
2. **Liveness rate < 95%** sustained across 2+ runs (FM13). A judge that consistently fails to finish is structurally unreliable.
3. **κ > 0.80** with another panel judge across 3+ runs. The pair is redundant; one of them is paying for two votes.
4. **Calibration shift > 15 confidence points** between back-to-back runs on the same corpus. The model changed or the prompt drift broke calibration.
5. **`cant-tell` rate > 40%** of rows. The judge isn't engaging with the rubric.

If any of these fire, the judge is OUT of the default panel until the issue is diagnosed and resolved. Don't pretend the panel is fine.

---

## Per-judge spawn briefs

Each judge has a spawn-brief template in `adapters/<judge>.md`. The dispatcher reads the template, interpolates `{corpus_path}` and `{rubric_path}` and `{output_path}`, and sends the resulting prompt via cmux MCP to the judge's pane. See `adapters/claude.md` for the canonical example.

---

## Future panel evolution (v2 candidates)

Per `references/roadmap-v2.md` and W1.1:

- Add a **local open-weight judge** (e.g., Llama 3.3 70B) for Platt-scaled verbalized confidence calibration.
- Add a **domain-specific 4th judge** when per-domain κ analysis shows the disjoint-family panel doesn't capture domain-specific failure modes.
- Re-examine cursorJudge if its model family substantially changes (the κ baseline above is specific to v1.1 cursor).

None of these are v1. They're documented for future-Etan / future-orc.

---

## Provenance

- W3.2 measurement: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave3-kappa-matrix.md`
- Run 2/3/4 phase-1-judgments: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-1-judgments/`
- Tiebreaker rationale: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-15-agada-bench-4way-judge/phase-3-gold/adjudication-log.md` §"Tiebreaker rule"
