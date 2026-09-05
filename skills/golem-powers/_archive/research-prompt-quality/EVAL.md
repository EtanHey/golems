# EVAL — research-prompt-quality

Scope: `skill-creator/docs.local/research-prompt-quality-SCOPING.md` (gen-10, 2026-05-29).

## Rubric (5 × 0–2 → /10)

| Dimension | What it measures |
|-----------|------------------|
| existing-work-check | Searched prior research/plans first; STOP if done |
| drive-grounding | Brain Drive / `03_RESEARCH` folder refs |
| current-usage-examples | ≥1 concrete repo path + mechanism |
| prior-research-reconciliation | BUILD-ON / VALIDATE / REFUTE (not restart) |
| non-redundancy | Does not re-propose finished research |

**RED gate (fixtures):** NEG ≤4/10, POS ≥8/10.

## Fixtures (real, on disk)

| ID | File | Expect |
|----|------|--------|
| NEG-1 | `evals/fixtures/neg-1-flat-mcl.md` | ~2–4/10 |
| NEG-2 | `evals/fixtures/neg-2-redundant-rrf.md` | 0–2/10 |
| POS-2 | `evals/fixtures/pos-2-rrf-correct.md` | 9–10/10 |

## Functional self-QA — literal stdout

### `check-first.sh "RRF"` (exit 1 = STOP)

```
check-first: query="RRF" pattern=(rrf)
check-first: scanned Drive roots=0 repos under $HOME/Gits
check-first: canonical prior RRF artifacts (verified):
  - [OK] $ORCHESTRATOR_ROOT/docs.local/research/2026-05-26-cormack-vs-brainlayer-corpus.md
  - [OK] $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/A8-per-agent-ranking-and-syllabi.md
  - [OK] $HOME/Gits/brainlayer/docs.local/research/2026-05-26-rrf-domain-stage1.md
  - [OK] $SKILL_CREATOR_ROOT/docs.local/handoffs/2026-05-17/web-weave/rrf-k-tuning.md
  - [OK] $HOME/Gits/brainlayer/docs.local/plans/2026-05-15-bl-overhaul/phase-3-hybrid-search-rrf
  - [OK] $COACH_ROOT/docs.local/decisions/2026-05-26-cormack-rrf-deep-research.md
check-first: 159 hit(s) (showing up to 30):
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-rrf-domain-stage1.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-27-design-research-prompts-puddle-and-self-aware-enrichment.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-27-design-extensions/topic-B-self-aware-claude-desktop.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-27-design-extensions/topic-A-puddle-claude-desktop.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-27-design-extensions/topic-A-puddle-gemini-deep-research.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-27-design-extensions/topic-B-self-aware-gemini-deep-research.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/stream-1-claude-desktop-research.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/INDEX-stream-1-ranking.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/A7-in-house-ranking-tuning.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/FINAL.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/DRIVE-URLS.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/A5-prior-benchmark-summary.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/A4-stt-correction-dictionary.md
  - $HOME/Gits/brainlayer/docs.local/research/2026-05-26-research-lead/A8-per-agent-ranking-and-syllabi.md
  - $HOME/Gits/brainlayer/docs.local/research/brainlayer-source-types/responses/prompt-4-claude-desktop-opus47.md
  - $HOME/Gits/brainlayer/docs.local/plans/2026-05-15-bl-overhaul/collab.md
  - $HOME/Gits/brainlayer/docs.local/plans/2026-05-15-bl-overhaul/verified-assumptions.md
  - $HOME/Gits/brainlayer/docs.local/plans/2026-05-15-bl-overhaul/README.md
  - $HOME/Gits/brainlayer/docs.local/plans/2026-05-15-bl-overhaul/phase-3-hybrid-search-rrf/README.md
  - $HOME/Gits/brainlayer/docs.local/plans/2026-05-15-bl-overhaul/phase-3-hybrid-search-rrf
  - $COACH_ROOT/docs.local/plans/lecture-imagery-pipeline/collab.md
  - $COACH_ROOT/docs.local/plans/lecture-imagery-pipeline/README.md
  - $COACH_ROOT/docs.local/plans/resume-v6-factcheck/collab.md
  - $COACH_ROOT/docs.local/plans/resume-v6-factcheck/README.md
  - $COACH_ROOT/docs.local/plans/lecture-rehearsal-2026-05-23/WORKPLAN.md
  - $COACH_ROOT/docs.local/plans/lecture-rehearsal-2026-05-23/run-mp4-slide-boundaries.md
  - $COACH_ROOT/docs.local/plans/lecture-rehearsal-2026-05-23/stitch-pick-variation-B.md
  - $COACH_ROOT/docs.local/plans/lecture-rehearsal-2026-05-23/stitch-pick-variation-C.md
  - $COACH_ROOT/docs.local/plans/lecture-rehearsal-2026-05-23/stitch-pick-variation-A.md
  - $COACH_ROOT/docs.local/plans/lecture-rehearsal-2026-05-23/stitch-final-picks.md
  ... and 129 more

ALREADY RESEARCHED → (159 paths; full list omitted)
STOP: this is engineering / plan execution, not new deep research.
```

Shell exit code: **1** (expected for RRF).

### `score-research-prompt.py --all-fixtures` (exit 0)

```
=== neg-1-flat-mcl.md ===
path: $HOME/Gits/golems/skills/golem-powers/research-prompt-quality/evals/fixtures/neg-1-flat-mcl.md
  existing-work-check: 0/2
  drive-grounding: 0/2
  current-usage-examples: 1/2
  prior-research-reconciliation: 0/2
  non-redundancy: 1/2
TOTAL: 2/10
RED GATE: pass

=== neg-2-redundant-rrf.md ===
path: $HOME/Gits/golems/skills/golem-powers/research-prompt-quality/evals/fixtures/neg-2-redundant-rrf.md
  existing-work-check: 0/2
  drive-grounding: 0/2
  current-usage-examples: 0/2
  prior-research-reconciliation: 0/2
  non-redundancy: 0/2
TOTAL: 0/10
RED GATE: pass

=== pos-2-rrf-correct.md ===
path: $HOME/Gits/golems/skills/golem-powers/research-prompt-quality/evals/fixtures/pos-2-rrf-correct.md
  existing-work-check: 2/2
  drive-grounding: 2/2
  current-usage-examples: 2/2
  prior-research-reconciliation: 2/2
  non-redundancy: 2/2
TOTAL: 10/10
RED GATE: pass
```

## Historical generation comparison

HISTORICAL NON-COMPARABLE. The generation comparison found that the skill
redirected a redundant research request toward existing work and produced more
grounded prompts. Its original numeric grades and delta are withdrawn because
the effective runtime model and effort were not observed. Original values remain
available in git history.

## Ship marker

**RPQ_SHIPPED 429** — https://github.com/EtanHey/golems/pull/429 (merged 2026-05-29)
