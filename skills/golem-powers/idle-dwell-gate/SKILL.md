---
name: idle-dwell-gate
description: "Mechanical autonomy gate: flag no-input-decisions + idle-seat-with-open-queue over agent transcripts. Triggers: turn-end autonomy check, /orc + /pr-loop completion, lead about to pause."
disable-model-invocation: true
---

# Skill: Idle-Dwell Gate (gen-18 Track 1 — the Fix-2 outcome gate)

> An idle seat with an open queue is not done. Authorization IS permission to drive.
> This is the MECHANICAL gate the prose kept failing to replace (R-001, 6+ generations BROKEN-OPEN).

## What It Is

A deterministic detector over an agent transcript that classifies the **terminal action** as an
autonomous DRIVE or an idle-dwell VIOLATION. Build-the-gate-not-the-prose: the pinned RED/GREEN
transcript fixtures in `evals/fixtures/` ARE the replayable gate (R-003/R-014 pattern, consumed in
the T6 deterministic-CU smoke-spec shape).

## The Rule

When work is **authorized** (mission sign-off, approved queue, plan-authorized next phase with no hard
gate, collab dispatch) and the queue is **open**, the next action MUST be a drive:
- a worker **dispatch** (`send_to` / cmux spawn into an existing seat), OR
- a **resume** of the original session (`repoGolem --resume <session-id>` — never a fresh spawn over a
  resumable crashed lead), OR
- **self-driving** the authorized work (push, open the PR, edit, build), OR
- a **genuine hard-gate** pause only (visual sign-off, irreversible external action, missing secret,
  physical presence, true external blocker).

Anything else with an open queue is a FLAG. Because this gate is judgment-shaped and false
positives are expensive, the hook is advisory-first: most FLAGs emit a Stop-hook
`{"systemMessage":"..."}` that names the specific queue item or worker and tells the seat to drive.
Only the two unambiguous classes below block the Stop hook with
`{"decision":"block","reason":"..."}`.

## Violation Taxonomy (codes the detector emits)

| Code | What it catches |
|---|---|
| `NO_INPUT_DECISION` | `AskUserQuestion` / "should I merge X?" / "want me to…" for coordination on already-authorized work |
| `IDLE_SEAT_OPEN_QUEUE` | terminal turn is a summary-and-stop while authorized work is queued |
| `DEFERRAL_AFTER_AUTHORIZATION` | re-confirm / "ready when you are" / "awaiting approval" after the work was authorized |
| `BACKLOG_HANDED_TO_USER` | hands the remaining queue to the user as triage items |
| `SPAWN_OVER_RESUMABLE` | fresh `spawn_agent` over a resumable crashed lead (R-036; discards live context) |
| `DONE_WORKER_UNHARVESTED` | BLOCK: registry says worker state=done + pane open + unharvested for N minutes |
| `APPROVED_ITEM_UNSTARTED_ZERO_WATCHES` | BLOCK: queue item approved + no user input needed + unstarted + zero active watches |
| `IDLE_DONE_WORKER_PANE_OPEN` | advisory: harvested DONE worker pane left open post-harvest (visibly-alive failure signal) |
| `BOOT_FAILED_WORKER_STALL` | advisory: boot-failed worker has non-empty composer and zero tool calls since spawn |

## Advisory / Block Split

- **BLOCK** only when the detector can name an objective, unambiguous action:
  `DONE_WORKER_UNHARVESTED` and `APPROVED_ITEM_UNSTARTED_ZERO_WATCHES`.
- **ADVISORY** for all other FLAGs (`NO_INPUT_DECISION`, `IDLE_SEAT_OPEN_QUEUE`,
  `DEFERRAL_AFTER_AUTHORIZATION`, `BACKLOG_HANDED_TO_USER`, `SPAWN_OVER_RESUMABLE`,
  `IDLE_DONE_WORKER_PANE_OPEN`, `BOOT_FAILED_WORKER_STALL`). The hook output is a
  `systemMessage` naming the specific item/worker when available.
- **ALLOW** when the seat is waiting on a genuine Etan-only decision with monitors armed, a worker
  seat is awaiting lead review, queue items are gated on external events with watches armed, a fresh
  seat is still orienting, or the transcript is merely discussing idleness.

## How /orc and /pr-loop Consume It

- **`/orc` autonomy eval** — before a lead/orc seat ends a turn with an open queue, run the gate on the
  turn. `FLAG` ⇒ do NOT stop: dispatch, resume, or self-drive the queued work. Only a `HARD_GATE` pause
  is allowed. The orchestrator may pass `{ queueOpen: <bool> }` when it knows the queue state
  authoritatively.
- **`/pr-loop`** — the gate backs "Parking Is the Violation": a finished, approved branch left
  "awaiting PR approval" is `IDLE_SEAT_OPEN_QUEUE`. Finish the loop to MERGED; surface the PR number,
  not a permission question.

## Run It

```bash
# Replay the deterministic gate (CI-safe, the standing regression suite):
bun test skills/golem-powers/idle-dwell-gate/evals/idle-dwell-gate.test.mjs

# Run the gate over a live transcript (exit 3 = FLAG, 0 = PASS — wireable as a Stop hook):
bun skills/golem-powers/idle-dwell-gate/scripts/idle-dwell-gate-cli.mjs <transcript.jsonl|->

# Claude Code Stop-hook wrapper (stdout: {}, systemMessage, or decision:block):
node skills/golem-powers/idle-dwell-gate/scripts/idle-dwell-gate-hook.mjs < hook-payload.json
```

Programmatic: `import { detectIdleDwell, hookPayloadFor } from "./src/idle-dwell-gate.mjs"` → `{ verdict, violations, hookDecision, terminalAction, queueOpen }`.

## Stated Limits (honesty rule)

- Detects the **terminal** action; it is a turn-end / completion check, not a mid-turn monitor.
- Marker-anchored: a hard gate fabricated with hard-gate phrasing can mask a real idle-dwell. The
  fixtures pin the known specimens; new evasion shapes are added as RED fixtures (the R-003 model).
- "Authorized" is inferred from transcript markers unless the caller forces `opts.queueOpen`.
- State-aware cases (`state.queue`, `state.workers`, `state.watches`) are deterministic registry
  checks; absent state, the detector stays marker-anchored and advisory-first.

## Provenance

RED specimens: golems/424e8065#1, orchestrator/263b3559#2, orchestrator/9bfa306b#3, codex/019ed5dd#1,
orchestrator/1e8746db#5, cmuxlayer/3983543f#1. GREEN reference: narrationlayer/019ee3dd#5 (Codex worker
drove the full pr-loop to MERGED — proving the gap is orchestrator-seat-specific, not universal).
