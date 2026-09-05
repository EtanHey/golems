# Workflow: κ validation (drop-judge methodology)

> How to use Cohen's κ to decide whether a judge is earning its keep, and which judge to drop if the panel is too redundant. W3.2's methodology, codified.

---

## What this gives you

After every run, `phase-2-crossref/kappa-matrix.md` shows pairwise inter-rater agreement for every pair of judges. Use it to answer:

1. **Is the panel disjoint enough?** If any κ > 0.80, two judges are basically voting the same way; you're paying for one voter but counting two.
2. **Which judge is the most independent?** Lower mean κ across that judge's pairs = more independent voter.
3. **Which judge can be dropped?** The judge that's part of the highest-κ pair.
4. **Has calibration drifted since Run N?** Compare κ̄ vs the historical baseline.

---

## Cohen's κ refresher

For two judges on K labels over N items:

```
κ = (P_obs - P_exp) / (1 - P_exp)

P_obs = fraction of items where both judges agree on exact label.
P_exp = expected fraction of agreement if both judges labeled randomly,
        weighted by each judge's marginal label distribution.
```

Interpretation (Landis-Koch):

| κ range | Strength |
|---|---|
| ≤ 0.20 | Slight |
| 0.21–0.40 | Fair |
| 0.41–0.60 | Moderate |
| 0.61–0.80 | Substantial |
| 0.81–1.00 | Almost perfect → **redundant for ensemble purposes** |

`agada-bench` uses **weighted κ** (linear weights) so a 0-vs-1 disagreement counts less than 0-vs-3. This matters: the unweighted version overcounts close calls as "disagreement" and washes out the disjoint-family signal.

---

## How to read kappa-matrix.md

```markdown
# Cohen's κ Matrix — phase-1-judgments/

Bootstrap iters: 1000, 95% CI shown in brackets.
Mode: weighted (linear) Cohen's κ.

## Pairwise κ

| Pair | κ (weighted) | 95% CI | Strength |
|---|---:|---|---|
| claude × codex   | 0.42 | [0.31, 0.53] | Moderate |
| claude × gemini  | 0.58 | [0.47, 0.69] | Moderate |
| codex × gemini   | 0.38 | [0.27, 0.49] | Fair |
| claude × cursor* | 0.81 | [0.72, 0.89] | Almost perfect |  ← REDUNDANT
| codex × cursor*  | 0.65 | [0.55, 0.75] | Substantial |
| gemini × cursor* | 0.59 | [0.48, 0.70] | Moderate |

(* — cursor was in this run as a 4th judge; omitted from production panel by default.)

## Per-judge mean κ (across their 3 pairs)

| Judge | Mean κ | Independence rank |
|---|---:|---|
| claudeJudge | 0.60 | #3 (most redundant) |
| codexJudge  | 0.48 | #1 (most independent) ← keep |
| geminiJudge | 0.52 | #2 |
| cursorJudge | 0.68 | #4 (dropped by default) |

## Drop-judge recommendation

Drop **cursorJudge** because:
- κ(claude, cursor) = 0.81 — highest single pair; cursor is structurally redundant with claude.
- Mean κ of 0.68 — highest in panel; provides least independent signal.
- Dropping it cuts cost ~25%; preserves κ̄ on remaining triad.

Keep **codexJudge** because:
- Mean κ of 0.48 — lowest in panel; most independent voter.
- κ(codex, claude) = 0.42 and κ(codex, gemini) = 0.38 — both below 0.5; codex consistently disagrees with the others on edge cases (FM11 × 17, FM8 × 3 unique catches).
```

---

## The script

```bash
python scripts/kappa-matrix.py \
  --from-phase1 <output>/phase-1-judgments/ \
  --judges claude,codex,gemini,cursor \
  --out <output>/phase-2-crossref/kappa-matrix.md \
  --bootstrap-iters 1000 \
  --weights linear
```

Flags:
- `--from-phase1 <dir>`: directory containing `<judge>.jsonl` files.
- `--judges`: which judges to include (must all have a jsonl in the dir).
- `--out`: markdown output path.
- `--bootstrap-iters`: 1000 is default; reduce to 200 for a fast smoke, keep 1000 for production.
- `--weights linear` | `quadratic` | `none`: default `linear`. Linear is canonical for ordinal labels.
- `--corpus <path>`: optional. If passed, restrict κ computation to pairs both judges graded for corpus rows (excludes off-corpus FM12 rows).

Exit codes:
- `0`: success.
- `1`: at least one judge's jsonl missing or unreadable.
- `2`: a judge has zero corpus-aligned rows (likely a liveness failure — run `liveness-check.py` first).

---

## When to drop a judge

Use the κ matrix to flag, but don't auto-drop. Decision rules:

| Situation | Action |
|---|---|
| One pair κ > 0.80 sustained across 3+ runs | Drop the judge in the redundant pair with the higher mean κ. |
| All pairs κ < 0.40 | Panel may be too disjoint; check rubric calibration — judges might be using different label scales. |
| κ̄ drops > 0.15 vs historical baseline | Calibration drift. Don't drop; flag for rubric iteration. |
| One judge's mean κ jumps > 0.20 between runs | That judge changed (model version? prompt?). Investigate before next run. |

The default `claude,codex,gemini` panel was set per W3.2's empirical κ matrix from v1.1. Don't override casually — record the κ matrix that justifies the override in BrainLayer with imp ≥ 7.

---

## v1.1 baseline (W3.2 measurement)

Computed across Runs 2 + 3 + 4 phase-1-judgments (n ≈ 145 corpus-aligned rows per judge):

| Pair | κ (weighted) |
|---|---:|
| claude × cursor | **0.811** ← highest, drop motivation |
| claude × codex | 0.62 |
| claude × gemini | 0.58 |
| codex × cursor | 0.56 |
| gemini × cursor | 0.52 |
| codex × gemini | **0.38** ← lowest, codex is most independent |

Mean κ:
- claude: 0.67
- cursor: 0.63
- gemini: 0.49
- codex: **0.52** (most independent)

Verdict from W3.2: drop cursor, keep codex as the disjoint voter. Production panel = `claude,codex,gemini`.

---

## Composability

This workflow is referenced by:
- `workflows/full-sweep.md` (Phase 2.5)
- `scripts/run-agada.sh` (called between build-crossref and build-gold)

It can be invoked standalone for retrospective κ-on-historical-runs analysis.

---

## Provenance

- W3.2 design + first-pass κ measurement: `$ORCHESTRATOR_ROOT/docs.local/plans/2026-05-16-agada-v1.2-wave3-kappa-matrix.md`
- Cohen 1968 (the original kappa paper) — implemented via scikit-learn `cohen_kappa_score(weights='linear')` in the script.
