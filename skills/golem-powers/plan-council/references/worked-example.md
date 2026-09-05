# Worked Example — BrainLayer Migration Plan

This is a compact transcription of the live council receipts, not a synthetic example.

## Independent rubrics

| Seat | Family | Rubric dimensions and weights |
|---|---|---|
| R1 | Opus | deploy truth 25; data safety/reversibility 20; diagnosis fidelity 20; sequencing and gate integrity 15; scope completeness 10; human-cost realism 10 |
| R2 | Codex | premise truth/live evidence 30; complete falsifiable contract 25; data safety and dependency correctness 25; executing-artifact/live proof 20 |
| R3 | Fable | receipt fidelity 25; gate soundness 25; blast-radius control 20; sequencing 15; ratification traceability 15 |

The independent rubrics mattered: R1's deploy-truth dimension found that merged code was not the
artifact actually executing.

## Measured same-family bias

The reviewed plan was Fable-authored.

| Lane | Fable same-family | Opus | Codex | Conservative non-family | Same-family delta |
|---|---:|---:|---:|---:|---:|
| 3d migration ledger | 8 | 3 | 4.20 | 3 | +5 |
| W2.5-R1 embed starvation | 9 | 5 | 5.55 | 5 | +4 |
| W3 preconditions | 7 | 4 | 4.05 | 4 | +3 |
| 3a source_class | 6 | 5 | 5.25 | 5 | +1 |
| Overall summaries (R1/R3 weighted; R2 lane average) | 7.4 | 4.3 | 5.6 | 4.3 | +3.1 |

The merge law therefore uses the minimum non-author-family score on each disputed lane, not the
mean and not the same-family read.

## Lift round

R1's lift table contained 16 rows: 13 `No` research calls, 2 narrow `YES` calls, and 1 named
near-miss. Its conclusion was that weak lanes mostly reflected unread local state—a symlink, a stuck
stack frame, a launchd inventory, and three SQL counts—not missing external knowledge.

## Exact-head correction

The execution log contains 113 `exact head` references. After three consecutive breadth-only rounds,
an axis-changing round pushed the severity ladder one rung higher and found a genuine hole that twelve
prior heads had missed. That is why the stop-line is axis-qualified.

A separate Wave 3a review returned MUST_FIX at exact head `99713eba` with 3 gate items: incomplete
default-search enforcement, a runbook that did not deploy the code it migrated for, and an incomplete
live-writer stop inventory. The migration mechanics themselves were sound; the surrounding surface
was not.

## Source receipts

- Rubrics, scorecards, bias inputs, and lift tables:
  `$ORCHESTRATOR_REPO/collab/2026-08-09-brainlayer-council-REAL.md`
- Exact-head loop, axis-changing stop-line correction, and Wave 3a MUST_FIX:
  `$ORCHESTRATOR_REPO/collab/2026-08-09-brainlayer-wave25.md`
- Seat pins, visible-pane rationale, monitors, spawn verification, and process summary:
  `$HOME/Gits/cmuxlayer/docs.local/tasks/brainlayer-plan-process-reply.md`
