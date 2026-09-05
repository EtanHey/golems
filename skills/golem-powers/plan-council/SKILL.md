---
name: plan-council
description: "Cross-family judge council over ONE authored plan or spec. Triggers: council, review my plan, score the plan, judge the plan, cross-family judges, lift round, exact-head review, conditional GO, MUST_FIX. NOT for anonymized candidate ranking (/adversarial-council) or bulk verdict fleets (/judge-fleet)."
---

# Plan Council

Review one authored plan or spec with declared cross-family judges. Disagreement is evidence:
preserve each judge's independent rubric, validate claims against live local state, and let the
conservative non-author-family score govern disputed lanes.

## Scope

The council runs 3 visible seats from 3 model families, self-invented rubrics, live-repo read-only validation, measured same-family bias, a lift round, and exact-head review loops.

## Output contract

EVERY artifact this protocol emits — ballot, lift table, convener report — leads with its table; environment caveats and preamble go BELOW the first table, never above it.

## Route first

| Need | Use |
|---|---|
| Review one authored plan/spec with declared judge families and measured bias | `/plan-council` |
| Rank multiple anonymized candidates without authorship signals | `/adversarial-council` |
| Fan out bulk verdict production over many prompts/items | `/judge-fleet` |

## Five laws

### 1. Seats

- Convene **3 voting seats from 3 model families** in visible cmux panes: R1 Opus 5, R2
  GPT-5.6-Sol at xhigh, and R3 Fable 5. Never use background subagents.
- Pin every seat explicitly and verify the effective model from the pane. The Fable seat uses raw
  `claude --dangerously-skip-permissions --model claude-fable-5` because the repoGolem launcher cannot express it.
- Supply no shared rubric. Each judge invents named dimensions and weights totaling 100.
- Each judge scores every lane 1-10, checks the live repo read-only, makes findings falsifiable,
  gives GO / NO-GO / CONDITIONAL GO per gated unit, names its top three changes, signs its family,
  and ends with its agreed sentinel.
- Each judge's FIRST output line after the ballot heading must be the scorecard TABLE header; judges write no prose before it.

Use [references/seat-briefs.md](references/seat-briefs.md) and
[workflows/run-council.md](workflows/run-council.md).

### 2. Merge

- The plan author holds no seat and scores nothing.
- Do not average disagreement away. For each disputed lane:
  `merged(lane) = min(non-author-family judge scores)`.
- Report same-family bias per lane and the round mean. Flag a same-family judge at **≥ +2** above
  the conservative non-family read.

```bash
python3 <plan-council-skill-dir>/council_bias.py <ballots-dir> --author-family <author-family>
```

### 3. Lift round

For every lane below 8, ask every judge for **THE ONE artifact** that would lift it above 8 and an
explicit research call. The governing instruction is:

> **one** artifact each, and it must be the thing whose absence is why the score is low — not a
> wish list.

Run [workflows/lift-round.md](workflows/lift-round.md). Conditions addressed to the author are work:
apply them and continue. They are not ratification theater. Irreversible state changes retain their
own receipt-first HARD STOP.

### 4. Exact-head review

Every execution verdict names the exact head SHA. ACCEPT / ITERATE / MUST_FIX without that SHA is
void. The ACCEPTED head is the merged head; any later head movement makes the verdict stale and
requires re-review.

Every review round declares its axis and method. A stale-only round counts toward a published
stop-line only when it explores the same axis as the prior round **and uses an adversarial method
that attempts to defeat the rules**. A confirmatory happy-path round never counts; changing axis
resets the counter. Publish axis, method, counter, and stop-line before dispatch. See
[workflows/exact-head-review.md](workflows/exact-head-review.md).

### 5. Conditions are work

Apply council conditions assigned to the author and go. Do not park approved work behind another
ratification step. This does not weaken independent data-safety gates for migrations, backfills, or
other irreversible operations.

## Validate ballots

```bash
python3 <plan-council-skill-dir>/council_lint_cli.py ballot.md \
  --lane "W3 preconditions" --lane "3a source_class" \
  --author-seat <author-voting-seat-or-nonseat-id> --sentinel DONE_COUNCIL_R1
python3 -m pytest <plan-council-skill-dir>/tests/ -q
```

| Rule | Required invariant |
|---|---|
| `table-not-first` | First content after the ballot heading is a markdown table. |
| `missing-rubric` | Multiple named rubric dimensions carry weights. |
| `rubric-weights-not-100` | Weights sum to 100 within ±0.5. |
| `unscored-lane` | Every CLI-declared lane has a numeric score. |
| `score-out-of-range` | Every score is within 1-10. |
| `unfalsifiable-finding` | At least one F-numbered finding has a file:line, command, query, PR, or issue locator. If the ballot is checkable overall, each remaining uncited finding is reported as a warning. |
| `missing-refuter` (warning) | No explicit `Refute me with:` / `Falsifier:` guidance; reported but never exit-1. |
| `missing-live-receipts` (warning) | No distinct self-verified receipts section; reported but never exit-1. |
| `missing-conditional-verdict` | The ballot gives at least one explicit uppercase gating verdict: GO / NO-GO / CONDITIONAL GO / BLOCK / HOLD / RESHAPE / RESCOPE / REDESIGN. |
| `missing-family-signature` | Signature is `— R<n> · <declared family> · <harness>`; any declared family is legal. |
| `missing-sentinel` | The agreed sentinel is the final non-empty line. |
| `author-scored` | The signed voting-seat ID is not the seat held by the plan author (`--author-seat R<n>`). When the author holds no seat, pass its non-seat ID; family equality never fails lint. |

`author-scored` enforces the operator-declared author seat; detecting covert authorship would require
adding agent identity to the signature contract.

The mechanical contract has **10 gate rule IDs + 3 warning types**. Checkability is ballot-scoped:
`unfalsifiable-finding` rejects a ballot when none of its findings has a concrete locator, then warns
on individual uncited findings when at least one sibling is cited. The refuter and receipts warnings
remain visible but non-gating; the source corpus proves that strong ballots can omit those house-style
forms and can include a paper-contract finding beside live verified findings.

## Anti-patterns

| Don't | Evidence |
|---|---|
| Run judges as background subagents | Etan distrusted the council; visible panes from round one. |
| `tail -f` a collab for judge output | It dies silently; use marker-count polling, one monitor per lane, killed with the lane. |
| Assume a spawned seat booted | A lane was lost to a silently dead launcher; verify with `read_screen` within 30 seconds. |
| Re-brief a running judge by editing a file | Files do not bind running agents; re-brief in-pane. |
| Accept prose-first ballots | Use table-first, one page: running / needs-receipt / needs-rework. |
| Average disputed scores | Same-family bias ran +3 to +5; the conservative non-family read governs. |
| Park approved work behind ratification | Conditions to the author are work; apply and go. |
| Merge a head the reviewer never ruled on | The ACCEPTED head is the merged head. |
| Stop after quiet rounds that changed axis | An axis-changing round found a hole twelve prior heads missed. |

## Receipts

The numeric claims and worked example come from the read-only source trail documented in
[references/worked-example.md](references/worked-example.md).
