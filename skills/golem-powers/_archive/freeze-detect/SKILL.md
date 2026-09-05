---
name: freeze-detect
description: "Use when supervising cmux or similar agent surfaces that look unchanged, quiet, or token-frozen. Distinguishes stale parsed telemetry from genuinely idle workers by rotating one full read onto the worst offender, requiring prompt proof before calling a surface idle, and parking monitor loops around known long-running operations. Triggers on: parsed_only, frozen screen, idle codex, no token movement, stuck worker, long-running build, long-running test."
---

# Skill: Freeze Detect

> Repeated partial telemetry is a suspicion, not a verdict. Escalate one surface to a full read, then reason from what you actually saw.

## When to Use

- Monitoring multiple agent surfaces where `parsed_only` output keeps repeating
- Deciding whether a quiet worker is idle, frozen, or still active
- Reviewing loop logic that wants to label a surface "idle" from wrapper text, token counts, or no recent deltas
- Handling long-running builds, tests, installs, or deploys that can make a surface appear unchanged for minutes

## Why This Exists

`parsed_only=True` is compressed telemetry. It can repeat the same wrapper while the underlying surface is still active. A loop that treats repeated parsed snippets as truth will:
- spam low-signal reads across every surface
- fabricate "idle" for an active worker
- break `/monitor-loop` counter discipline by resetting or parking for the wrong reason

This skill forces a narrow verification path: escalate one suspect surface per tick, read the full screen, and prove idleness before you say it.

## The Core Loop

When monitoring `N` surfaces, keep lightweight telemetry on all of them, but escalate only one surface to a full read per tick.

Required fields:
- `parsed_only_signature`
- `consecutive_matching_parsed_ticks`
- `last_full_read_time`
- `last_full_read_summary`
- `last_known_long_running_op`
- `idle_candidate_since`

Tick shape:

```text
1. Gather parsed-only snapshots for all monitored surfaces.
2. Identify which surfaces have matching parsed signatures across repeated ticks.
3. Select the single worst offender:
   - highest `consecutive_matching_parsed_ticks`
   - oldest `last_full_read_time`
   - highest operational risk if misclassified
4. Run exactly one full read on that surface this tick.
5. Classify it as:
   - active
   - idle-candidate
   - long-running
   - unknown-needs-recheck
6. Carry the result back into `/monitor-loop` without declaring success from telemetry alone.
```

## Decision Tree

### 1. Parsed-Only Match Across N Ticks

If `parsed_only` output matches across repeated ticks, do **not** call the surface idle.

Action:
- force one full read on the worst offender
- leave all other matching surfaces on parsed-only for that tick
- rotate to another offender on the next tick if needed

This is the anti-spam rule. Five suspicious surfaces do not justify five full reads in one cycle.

### 2. Full Read Shows Active Work

If the full read shows any of these:
- streaming logs
- changing test/build output
- a tool still running
- a command still attached without a shell prompt
- progress text that explains a multi-minute operation

Then the surface is **active**, not idle.

Action:
- mark the worker active
- reset `idle_candidate_since`
- keep `/monitor-loop` focused on the queue, not on poking the worker

### 3. Full Read Shows a Long-Running Operation

If the full read shows the worker is in a known multi-minute operation such as:
- test suite
- build
- dependency install
- deployment
- migration

Then classify it as **long-running**.

Action:
- park the monitoring loop for that worker, not the worker itself
- record the operation from the full read summary
- set a `15m` re-check interval before the next full read unless another stronger signal arrives

The point is to reduce monitor churn while preserving the worker's runway.

### 4. Full Read Looks Quiet

A quiet full read is still not enough to declare idleness. Only declare **idle** when both conditions hold:

1. A shell prompt indicator is visible at the bottom of the full screen:
   - `›`
   - `>`
   - `$`
2. The **full-screen** read is materially identical for at least `60s`

If either condition is missing, the surface is only an **idle-candidate**.

Action:
- if prompt is visible but 60s has not elapsed, keep the surface as idle-candidate and re-check later
- if 60s elapsed but no bottom-of-screen prompt exists, treat the state as unknown and keep monitoring

## Hard Rules

### 1. One Full Read Per Tick

When several surfaces look frozen, escalate only the single worst offender to a full read that tick.

Do not:
- full-read every matching surface
- broadcast a freeze diagnosis to all surfaces from one wrapper pattern
- convert monitor loops into read-amplification loops

### 2. Prompt Proof Required For Idle

No prompt at the bottom of the screen means no idle verdict.

Acceptable proof:
- `›` at the bottom after an agent turn finishes
- `>` at the shell prompt
- `$` at the shell prompt

Unacceptable proof:
- repeated parsed wrapper text
- no token movement
- "looks done"
- elapsed time alone

### 3. Token-Frozen Does Not Mean Idle

Token counts can stall while tools keep working. Tool calls, subprocesses, and long-running commands often do not produce billable token movement.

Therefore:
- token-count-frozen != idle
- unchanged token numbers are only a hint to inspect the surface

### 4. Long-Running Ops Park The Monitor, Not The Worker

Do not interrupt or re-dispatch a worker just because the screen is stable during a build or test.

Instead:
- park that monitoring branch
- record the known long-running op
- schedule the next full read in `15m`

### 5. Unknown Beats Fabricated

If a full read cannot prove idle or active state, say `unknown-needs-recheck`.

`/never-fabricate` applies here: repeated telemetry, wrapper text, and token counters are not evidence strong enough to claim a worker is idle.

## Worst-Offender Ranking

When multiple surfaces match parsed-only telemetry, rank them by:

1. largest `consecutive_matching_parsed_ticks`
2. oldest `last_full_read_time`
3. highest chance of harming queue decisions if misclassified

Examples of high-risk surfaces:
- the only worker expected to unblock a merge
- a worker whose prior full read was ambiguous
- a surface about to be escalated as "idle"

## Composition With Other Skills

| Skill | How it composes |
|---|---|
| `/monitor-loop` | Supplies the tick state machine and ensures freeze checks still end in dispatch, verify-and-decrement, or park |
| `/never-fabricate` | Prevents treating parsed-only wrappers, token counts, or silence as proof of idleness |

## Anti-Patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| 15 parsed reads for 5 surfaces across 3 ticks | Repeats low-signal telemetry and still learns nothing | Rotate one full read per tick onto the worst offender |
| "Token count hasn't moved, so the codex is idle" | Tool work may continue without token movement | Use token freeze as a hint, then read the full surface |
| Prompt appears once in the middle of the screen | Mid-screen prompt fragments are not bottom-of-screen idle proof | Require prompt indicator at the bottom plus 60s identical full reads |
| Build output unchanged for 2 minutes, so worker is frozen | Stable build/test output is often normal | Mark long-running, park monitor branch, re-check in 15m |
| Parsed-only wrapper says idle | Wrapper text is telemetry, not truth | Full read and classify from actual screen evidence |

## Rewrite Protocol

When a loop or monitor policy violates this skill:

1. Remove any rule that labels a surface idle from parsed-only text alone.
2. Add per-surface tracking for parsed signature, last full read, and idle-candidate timing.
3. Insert a single worst-offender full read into each suspicious tick.
4. Require bottom-of-screen prompt proof plus 60s identical full reads before an idle verdict.
5. Add the long-running carve-out with a `15m` re-check.
