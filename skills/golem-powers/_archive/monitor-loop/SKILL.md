---
name: monitor-loop
description: "Use when running or reviewing any recurring monitor loop for merge queues, worker queues, collab tails, or agent completion. Enforces drive-to-completion ticks: every tick must query live state with `!`, classify whether real progress happened, and then dispatch, verify-and-decrement, or escalate-park. Triggers on: monitor loop, /loop, recurring tick, keep monitoring, silent autonomous, merge gate, blocked review, no-progress loop."
---

# Skill: Monitor Loop

> A monitor tick is not a diary entry. It must drive the queue forward or stop itself.

## When to Use

- Writing a new `/loop`, cron tick, or recurring monitor prompt
- Reviewing an existing monitoring loop for stale-state, no-op repetition, or chat-spam
- Supervising merge queues, agent work, collab tails, or file-producing tasks
- Replacing passive rules like "keep monitoring" or "say I'm monitoring"

## Shared Primitive

This skill composes directly on `/cron-payload-discipline`.

> "The `!` syntax runs shell commands before the skill content is sent to Claude."

Every tick must use that primitive. The loop never reasons from a hardcoded state string like `BLOCKED REVIEW_REQUIRED`; it reasons from rendered live query output.

Required tick skeleton:

```text
Tick frame:
- now: $(date -Iseconds)
- cycle: <N>
- last-genuine-dispatch-time: <ISO-8601>
- consecutive-no-change-ticks: <N>
- consecutive-no-push-ticks: <N>
- park-threshold: <N>

Step 1: live queries with `!`
  !gh pr view <repo> <pr> --json mergeable,mergeStateStatus,reviewDecision
  !find <collab-dir> -newer <last-genuine-dispatch-time>
  !list_surfaces

Step 2: classify the delta from rendered output
Step 3: choose exactly one outcome:
  - dispatch
  - verify-and-decrement
  - escalate-park
```

## The State Machine

Track these fields on every tick:

- `consecutive_no_change_ticks`
- `consecutive_no_push_ticks`
- `last_genuine_dispatch_time`
- `park_threshold`

### Reset Rule

**Reset counters only on real queue-decrement.**

Real queue-decrement means one of:
- PR merged
- assigned agent task completed
- expected file or artifact was actually written

Not real progress:
- no-op ping
- rereading the same screen
- restating status
- seeing identical telemetry
- "still blocked" with no side-effect

If a claimed change came from partial telemetry, stop and verify. `/never-fabricate` applies here: frozen or quiet surfaces are not evidence of steady state.

## The Decision Tree

Every tick must produce exactly one of these outcomes:

### 1. Dispatch

Choose this when the live query shows a specific unblock or next action:
- PR is mergeable now
- review landed
- worker posted a new PR URL
- collab tail shows a new actionable milestone

Action:
- send one targeted dispatch that names the next side-effect
- update `last_genuine_dispatch_time`
- reset `consecutive_no_change_ticks`
- reset `consecutive_no_push_ticks` only if the dispatch consumes real new state

### 2. Verify-and-Decrement

Choose this when progress is claimed or implied, but not yet proven:
- worker says `TASK_DONE`
- collab says "merged"
- file probably exists
- parsed-only surface suggests completion

Action:
- run a full verification read
- confirm the side-effect happened
- if verified, decrement the queue and reset both counters
- if not verified, treat it as no real progress and continue counting

### 3. Escalate-Park

Choose this when the loop is repeating without real progress:
- state unchanged across ticks
- no verified queue decrement
- no new dispatch worth sending

Action:
- escalate once with the exact reason and next human/admin action
- park or kill the loop instead of narrating "still monitoring"

## Counter Rules

Increment `consecutive_no_change_ticks` when:
- live query output produces no material queue delta
- no new collab entry matters
- no verified completion happened

Increment `consecutive_no_push_ticks` when:
- the loop did not generate a new high-signal dispatch
- the only action was a no-op ping or passive restatement

Do not increment either counter after a verified queue decrement.

## Park Threshold

The threshold is explicit, not guessed.

- If the user or sprint brief names a threshold, use it.
- If no threshold is specified, default to `8` for hot-loop protection.
- For rollout decisions, compare `8`, `12`, and `16` against real fixtures before standardizing.

When `consecutive_no_change_ticks >= park_threshold`, the loop must park. It cannot keep emitting "monitoring" chatter.

## Hard Rules

### 1. Live Query First

Every tick starts with `!` live queries. This is inherited from `/cron-payload-discipline` and is mandatory here.

### 2. No Passive Tick Output

Forbidden:
- "I'm monitoring"
- "Monitor pass"
- "still watching"
- repeated `SILENT autonomous` with no decision context

Allowed outcomes are only:
- dispatch
- verify-and-decrement
- escalate-park

### 3. Counter Resets Need Verified Side-Effects

Do not reset counters because:
- a screen changed shape
- a timestamp advanced
- a worker answered
- a parsed-only read looked different

Reset only after verifying real queue-decrement.

### 4. Full Read Beats Parsed Telemetry

If a worker looks frozen or idle, do not assume steady state from parsed-only snippets. Read the full source that can prove the side-effect:
- PR state via `!gh pr view`
- file existence/content via `!find` plus a full file read
- worker completion via collab + artifact verification

### 5. One Tick, One Outcome

A tick may gather multiple signals, but it must resolve to one primary action. Mixed "maybe dispatch, maybe monitor" output recreates the original failure mode.

## Rewrite Protocol

When a loop violates this skill:

1. Remove hardcoded prompt-state.
2. Add frame fields: `now`, `cycle`, `last-genuine-dispatch-time`, both counters, `park-threshold`.
3. Move live `!` queries to step 1.
4. Classify whether any signal is a verified queue decrement, an actionable unblock, or no-change.
5. Rewrite the tick so it ends in dispatch, verify-and-decrement, or escalate-park.

## Anti-Patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| 12 identical `BLOCKED REVIEW_REQUIRED` ticks | Prompt-state is mistaken for reality | Use `!gh pr view` first, then branch |
| Resetting because a worker answered "looking" | Reply is not queue-decrement | Keep counting until side-effect is verified |
| Parsed-only surface says idle | Telemetry is not proof | Full read or artifact verification |
| "I'm monitoring" every cycle | No drive-to-completion action | Dispatch, verify-and-decrement, or park |
| Infinite silent loop with no threshold | Burned tokens, no escalation | Track counters and park explicitly |

## Composes With

| Skill | How it composes |
|---|---|
| `/cron-payload-discipline` | Supplies the mandatory `!` live-query-first frame discipline |
| `/never-fabricate` | Prevents treating telemetry, claims, or parsed-only reads as verified progress |
| `/freeze-detect` | Distinguishes repeated telemetry from genuinely active long-running work |
