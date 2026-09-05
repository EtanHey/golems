---
name: cron-payload-discipline
description: "Discipline for cron/loop/monitor payloads. Triggers: cron, /loop, recurring tick, merge queue, no-progress."
---

# Skill: Cron / Loop Payload Discipline

> Cron payloads must query reality first. If the prompt already claims the state, the loop is rotten before it runs.

## When to Use

- Writing a new `/loop`, cron tick, or recurring monitor payload
- Reviewing a payload that mentions PR state, agent state, collab state, or filesystem freshness
- Debugging repeated identical tick frames or "SILENT" loops that keep restating stale facts
- Any payload that is long enough to hide stale assumptions inside boilerplate
- Supervising merge queues, worker queues, collab tails, file-producing tasks, or quiet cmux workers
- Deciding whether a repeated parsed-only surface is genuinely idle, frozen, or still active

## The Shared Primitive

Anthropic-native `!` preprocessing is the foundation here:

> "The `!` syntax runs shell commands before the skill content is sent to Claude."

That means the payload should render live facts before Claude reasons about them. Claude should see current data, not a baked claim like `BLOCKED REVIEW_REQUIRED`.

## The Rule

**Never hardcode state strings inside a cron payload when the state can be queried live.**

Forbidden examples:
- `PR #123 is BLOCKED REVIEW_REQUIRED`
- `3 PRs are waiting at merge gate`
- `surface:7 is idle`
- `no collab changes since last tick`

Required replacement pattern:

```text
Tick frame:
- now: $(date -Iseconds)
- cycle: <N>
- last-action-timestamp: <ISO-8601>

Step 1: run a live query with `!`
  !gh pr view <repo> <pr> --json mergeable,mergeStateStatus,reviewDecision
  !list_surfaces
  !find <dir> -newer <last-action-timestamp>
  !brain_search "<topic>"

Step 2: reason from the rendered output, not from the template text
Step 3: dispatch, verify-and-decrement, or escalate-park based on the live result
```

For monitor loops, extend the frame:

```text
- last-genuine-dispatch-time: <ISO-8601>
- consecutive-no-change-ticks: <N>
- consecutive-no-push-ticks: <N>
- park-threshold: <N>
```

## Hard Rules

### 1. Live Query First

Step 1 in every cron payload must execute a live query.

Acceptable first-step queries:
- `!gh pr view`
- `!gh pr list`
- `!list_surfaces`
- `!read_screen`
- `!find <dir> -newer <timestamp>`
- `!brain_search`

If step 1 is explanation, status narration, or a pre-baked claim, the payload is invalid.

### 2. No Hardcoded State Claims

Do not embed review state, merge state, agent state, or queue state as facts in the payload body.

Allowed:
- "If the live PR query shows `REVIEW_REQUIRED`, dispatch reviewer follow-up."

Not allowed:
- "PR #189 is `REVIEW_REQUIRED`, keep waiting."

### 2a. Review Dispatch Pins PR Head SHA

Any review-dispatch payload must identify the PR by immutable head, not only by
branch name. Branch names can be renamed or force-pushed mid-review; PR #453's
review prompt named a branch that had already drifted.

Required payload data:
- PR number and URL
- `headRefName`
- `headRefOid`
- base branch

Allowed target forms:
- `headRefOid=<sha>` from `gh pr view <N> --json headRefName,headRefOid,baseRefName,url`
- `refs/pull/<N>/head` plus a cross-check that `git ls-remote origin refs/pull/<N>/head`
  matches `headRefOid`

Forbidden:
- "Review branch `<name>`" as the only target
- Prompts that let the reviewer resolve a branch name without checking the PR's
  current head SHA first

### 3. Frame Discipline Is Mandatory

Every recurring payload must include:
- `$(date)` or equivalent rendered current timestamp
- a cycle counter
- a `last-action-timestamp`

Without these, identical frames are hard to distinguish from a stuck loop.

### 4. The Decision Tree Must Consume Live Data

The payload's branching logic must reference the output of the live query, not a static narrative written above it.

Good:
- "If `!gh pr view` reports mergeable=`MERGEABLE`, dispatch merge."

Bad:
- "Since this PR is blocked, keep monitoring."

### 5. Drive-To-Completion Outcome

Every recurring monitor tick must end in exactly one primary outcome:

| Outcome | Use when | Required side-effect |
|---|---|---|
| `dispatch` | Live data shows a specific unblock or next action | Send one targeted instruction and update `last-genuine-dispatch-time` |
| `verify-and-decrement` | Progress is claimed or implied but not proven | Read the source of truth; decrement/reset only if the side-effect exists |
| `escalate-park` | Repeated ticks show no material queue delta | Escalate once with the exact blocker, then park/kill the loop branch |

Passive output like "I'm monitoring", "still watching", or repeated `SILENT`
with no decision context is invalid.

### 6. Counter Resets Need Verified Side-Effects

Reset `consecutive-no-change-ticks` and `consecutive-no-push-ticks` only after a
real queue decrement:

- PR merged
- assigned agent task completed
- expected file or artifact was actually written

No-op pings, identical telemetry, timestamp changes, and worker replies like
"still looking" are not progress.

### 7. Freeze Detection Uses Rotating Full Reads

Repeated `parsed_only` output, unchanged token counts, or quiet panes are hints,
not verdicts. When several surfaces look frozen:

1. Track `parsed_only_signature`, `consecutive_matching_parsed_ticks`,
   `last_full_read_time`, `last_full_read_summary`,
   `last_known_long_running_op`, and `idle_candidate_since`.
2. Escalate exactly one worst offender to a full read per suspicious tick.
3. Classify that surface as `active`, `idle-candidate`, `long-running`, or
   `unknown-needs-recheck`.
4. Rotate to another offender on later ticks if needed.

Idle requires both:

- bottom-of-screen prompt proof (`›`, `>`, or `$`)
- materially identical full-screen reads for at least `60s`

Known long-running operations (tests, builds, installs, deploys, migrations)
park the monitor branch, not the worker. Record the operation and re-check after
`15m` unless a stronger signal arrives.

### 8. Long Payload Gate

If a cron payload exceeds 30 lines and does not run a live query in step 1, treat it as a violation and rewrite it before use.

### 9. Lead/Orchestrator Inbound-Monitor Gate (Etan top priority, 2026-06-14)

> A lead finished its lane, posted "Back to silent 👋" with **no monitor armed**; work routed to it via collab was a **silent no-op**. A "standing by" seat with no live inbound monitor is the same failure as a passive `SILENT` tick (Rule 5) — it just hides behind "done."

If the payload belongs to a lead/orchestrator/weaver (a seat that receives collab-routed work):

- **An armed persistent inbound monitor is a precondition, not an option.** The seat's FIRST action is arming a native `Monitor` on its channel (`^### |BLOCKED|@<own-name>`, exclude own). A recurring tick whose seat has no armed monitor is invalid — fix the seat before the tick.
- **"Stand by" / "keep monitoring" ticks are only valid with a live inbound monitor AND a consumed live query.** Restate the channel tail (`!tail`/grep for new `@<name>`/`###`) in step 1 and branch on it. A tick that says "still standing by" without reading the channel is the passive-output violation of Rule 5.
- **Going idle-and-blind is never a valid terminal outcome.** Lane done → `dispatch` (pick up monitor-surfaced work) or an explicit `✅ DONE … monitor ARMED, standing by` that keeps the monitor running — never a stopped monitor.

Canonical law: `/cmux-agents` → "LEAD/ORCHESTRATOR MONITOR LAW"; `/orc` → "THE SECOND CARDINAL RULE".

## Rewrite Protocol

When a payload violates this skill:

1. Name the stale claim explicitly.
2. Remove hardcoded state strings.
3. Add a timestamped frame: `$(date)`, cycle, last-action-timestamp.
4. Move a `!` live query to step 1.
5. Add monitor counters when the payload supervises a queue.
6. Rewrite the decision tree so it consumes rendered query output.
7. End in `dispatch`, `verify-and-decrement`, or `escalate-park`.
8. For suspected freezes, add the one-full-read rotation and prompt-proof idle gate.

## Anti-Patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| "Monitor pass: 3 PRs blocked" | Prompt claims state before checking it | Replace with `!gh pr list/view` in step 1 |
| 40-line cron prompt, live query in step 6 | Stale framing dominates reasoning | Put live query in step 1 |
| `SILENT autonomous` repeated with no timestamps | Cannot tell fresh tick from copied frame | Add `$(date)`, cycle, last-action-timestamp |
| `BLOCKED REVIEW_REQUIRED` copied from yesterday | Model parrots stale state | Query review state live every tick |
| Resetting because a worker replied "looking" | Reply is not queue-decrement | Keep counting until a side-effect is verified |
| Parsed-only wrapper says idle | Wrapper text is telemetry, not truth | Rotate one full read onto the worst offender |
| Token count frozen, so worker is idle | Tool calls may continue without token movement | Full-read before any idle verdict |
| Build output stable for 2 minutes | Long-running ops can look unchanged | Park monitor branch and re-check later |

## Composes With

| Skill | How it composes |
|---|---|
| `/never-fabricate` | Prevents reporting prompt-state as verified reality |
| `/cmux-agents` | Supplies surface/agent inspection and prompt-delivery mechanics |
| `/pr-loop` | Merge queues should use these tick rules before claiming PR state |
