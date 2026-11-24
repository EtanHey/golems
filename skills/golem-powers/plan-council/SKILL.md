---
name: plan-council
description: "Plan councils, anonymized candidate ranking, bulk judge fleets, assumption checks. Triggers: council, review my plan, score the plan, judge the plan, validate plan, check assumptions, cross-family judges, lift round, exact-head review, conditional GO, MUST_FIX, peer ranking, anonymized review, adversarial verification, score multiple candidates, judge fleet, bulk judge, R3 verdicts, kg-judge, RT gate, evidence_degraded. NOT for one-off PR/code review."
---

# Plan Council

Review one authored plan or spec with declared cross-family judges. Disagreement is evidence:
preserve each judge's independent rubric, validate claims against live local state, and let the
conservative non-author-family score govern disputed lanes.

## Scope

The council runs 4 visible voting seats (Claude, Codex, Fable, Neon), self-invented rubrics, live-repo read-only validation, measured same-family bias, a lift round, and exact-head review loops.

## Output contract

EVERY artifact this protocol emits — ballot, lift table, convener report — leads with its table; environment caveats and preamble go BELOW the first table, never above it.

## Route first

| Need | Use |
|---|---|
| Review one authored plan/spec with declared judge families and measured bias | this page (Five laws below) |
| Rank multiple anonymized candidates without authorship signals | [references/anonymized-ranking.md](references/anonymized-ranking.md) + its own validator, `anonymized_ranking/council_lint_cli.py` |
| Fan out bulk verdict production over many prompts/items | [references/bulk-judging.md](references/bulk-judging.md) (seven rules + dispatcher checklist) |
| Check a multi-agent plan's claims before running it (VERIFIED / ESTIMATED / PHANTOM), then rewrite it | [references/assumption-check.md](references/assumption-check.md) |

Load-bearing rules from those references, so a router that stops here still gets them right:
- **Anonymized ranking:** no authorship leak (never name a participant engine or say "my
  proposal"), a numeric `Score:` per candidate, an `## Inputs read` section, and the sentinel as the
  last line. Resolve every cited symbol/line against the code before hand-off.
- **Bulk judging:** probe `brain_search` before fan-out (an enrichment-locked DB → HOLD); stage under
  a durable `eval_results/<campaign>/`, never `/tmp`; reason per prompt (scripts may validate, never
  produce verdicts); completion = `DONE/<worker>.done` files; append-only collab sections; flag
  `evidence_degraded` and filter it before bulk-apply; red-team gate before any bulk-apply.
- **Assumption check:** run it before any overnight or multi-agent sprint. Every PHANTOM claim is
  killed or verified; quantitative claims need a source.

## Five laws

### 1. Seats

- Convene **4 voting seats**, each visible: R1 `claude.judgment`, R2 `codex.implement`, the
  separately declared R3 Fable 5 seat (cmux panes), and R4 Neon (`gemini.judgment`), a real third
  vendor, as a T3 `delegate_task` child on provider `antigravity` (2026-11-24, Etan, via orc: "neon is
  respected just as much as opus"). Fable is an Anthropic model, so R4 gives a Claude-authored plan two
  non-Claude scores (R2 and R4) for the merge rule. Never use background subagents.
- R4 runs in an Antigravity thread with no guard hooks: its brief carries its own hard rules (read-only
  repo, the collab is its only write, no `rm -r`, no secrets, no push), per `/agent-routing` § Neon
  judgment tier. A brief without them is not sent. They are instructions, not enforcement: the thread
  can still call BrainLayer and run tools, so the convener audits R4's thread activity (memory calls,
  writes, pushes) before counting its ballot. If no Mac's antigravity instance can run a child,
  the council runs with R1–R3 and the report says `R4: unavailable (<reason>)`.
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
