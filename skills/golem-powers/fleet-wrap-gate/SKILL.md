---
name: fleet-wrap-gate
description: "Mechanical kill-gate: at a fleet-wrap / stand-down state, assert cron-count==0 — no health-watch / `/loop` / sleep-poll cron left armed. Triggers: fleet wrap, stand down, sprint close, going silent."
disable-model-invocation: true
---

# Skill: Fleet-Wrap Terminal-State Gate (gen-18 Track 1 #6)

> When the fleet wraps: ZERO polling crons. A "harmless" 5-minute health-watch left running all night IS the failure.
> Etan at dawn (verbatim, red-team verified): *"Why were you just listing my messages in WhatsApp the whole night? Why didn't you stop?"* — 2× imp-10.

## What It Is

A deterministic detector over an agent transcript plus durable cron/loop state: once a
turn reaches a **terminal / stand-down state** (fleet wrap, sprint close, "back to
silent", "only an Etan decision pending", "all work merged", `DONE`), **cron-count
MUST == 0**. If a durable registry/state file still contains a live cron or `/loop`,
the turn is blocked with a typed cleanup reason: **`FLEETWRAP_CRON_ALIVE`** or
**`FLEETWRAP_LOOP_ALIVE`**. This is the MECHANICAL gate that `/fleet-wrap` describes
in prose — "manual gates drift, automated gates don't." The pinned RED/GREEN transcript
and state fixtures ARE the replayable gate (R-003/R-014 pattern).

## The Rule

Two independent violation routes — a **banned poller** is never excused; a **generic cron**
is excused only by the monitor-law:

| At a terminal state, this... | Verdict |
|---|---|
| **banned poller** armed: `/loop` timer, `while true`/`for…seq`/`nohup … sleep` poll loop, or a durable live loop state entry | `FLEETWRAP_LOOP_ALIVE` — block with `TaskStop <id>` |
| **generic / periodic cron** live in durable state, or a same-turn `CronCreate` / `schedule_task` not cleared and not the inbound monitor | `FLEETWRAP_CRON_ALIVE` — block with `delete cron <id>` |
| **crons cleared** — durable cron/loop state has zero live periodic entries | PASS |
| **ONE inbound standby monitor** (even via a `CronCreate` framed as inbound), no health-watch/poll/loop | PASS |
| not a terminal turn (mid-sprint, still driving, more work queued) | PASS (N/A) |
| discussion about the fleet-wrap rule/gate, or a worker-seat scoped `DONE` that explicitly is not fleet wrap | PASS (N/A) |

Wrap-state doctrine line: **inbound collab monitor STAYS, everything periodic DIES, the
decision is left in front of Etan, then silence.**

**Terminal-state markers:** "fleet wrap", "stand down", "back to silent", "going silent",
"sprint close(d)", "all work merged", "only an Etan decision pending", "nothing queued",
plus inbound/standby posture ("standing by for Etan", "awaiting an Etan decision").
A bare *clearing* phrase ("cleared all crons") on its own is NOT a stand-down — it is blanked
before the terminal test so a mid-sprint "cleared old crons … more work queued" stays N/A.

**The ONE allowed exception (monitor-law):** a single persistent **INBOUND** collab/standby
monitor (waiting for Etan / an inbound reply) is allowed — including a real `CronCreate` the
narrative frames as that inbound monitor. What's banned is health-watch / status-poll crons,
`/loop` poll timers, and fleet-monitor loops. Calling a health-watch an "inbound monitor" does
NOT excuse it; a same-turn `CronDelete` of some *other* cron does NOT excuse a freshly-armed
poller; and a prose "no crons" disclaimer does NOT clear a cron actually invoked this turn
(all pinned as evasion REDs).

"Same turn" = the events since the last human message. Terminal-state markers come from
the turn's text; live cron/loop truth comes from durable state (`state`, `state_path`,
`cron_state_path`, `loop_state_path`, or bounded Claude task-state discovery in the Stop
hook). A prose claim such as "all crons deleted" or "cron-count=0" is NEVER trusted over
durable live state. DETERMINISTIC: same transcript/state in → same verdict out.

## How /fleet-wrap Consumes It

`/fleet-wrap` step 2 already states **"KILL ALL POLLING — `CronList` → `CronDelete` every
monitor/heartbeat/status cron, zero exceptions."** This gate makes it mechanical: before
the outgoing agent goes silent, run the gate on the wrap turn —
`bun skills/golem-powers/fleet-wrap-gate/scripts/fleet-wrap-gate-cli.mjs <transcript|->`
(exit 3 = FLAG). A FLAG means a cron or loop is still armed at stand-down: run the exact
cleanup action in the reason (`delete cron <id>` / `TaskStop <id>`), then go silent.

Hook wiring uses `scripts/fleet-wrap-gate-hook.mjs` as a Claude Code Stop hook. The hook
is local-only: no network, no BrainLayer, no subprocesses, bounded stdin/path/task-state
reads, and fail-open on malformed input or internal errors. It emits the Claude Code
stdout schema:

- allow: `{}`
- block: `{"decision":"block","reason":"..."}`
- advisory: `{"systemMessage":"..."}`

`install-snippet.json` pins the absolute Node path:
`$HOME/.nvm/versions/node/v22.22.0/bin/node`.

## Relationship to Track 6 D4 (frustration-capture, PR #523)

This gate **complements, does not duplicate** the frustration-capture Stage-A gate. That
hook (`frustration-capture-prompt.py` — `_FLEET_TICK_OPENER`, orchestrator-monitor
`_HARNESS_MARKERS`) filters INBOUND `scheduled_task_fire`/cron PROMPTS **by sender-identity**
so a cron tick is not misread as an Etan correction — i.e. it governs *reading* cron
prompts. THIS gate governs whether a cron is still **ARMED** at fleet-wrap. Two different
edges of the same cron-discipline surface; neither subsumes the other.

## Run It

```bash
bun test skills/golem-powers/fleet-wrap-gate/evals/fleet-wrap-gate.test.mjs   # replay (CI-safe)
python3 skills/golem-powers/fleet-wrap-gate/evals/run_suite.py                # hook stdout-schema suite
bun skills/golem-powers/fleet-wrap-gate/scripts/fleet-wrap-gate-cli.mjs <transcript.jsonl|->
```

Programmatic: `import { detectFleetWrap } from "./src/fleet-wrap-gate.mjs"` →
`detectFleetWrap(transcript, { state })` returns `{ verdict, terminal, violations }`.

## Stated Limits (honesty rule)

- Durable state is only as complete as the hook payload/default task-state source. If no
  state is available, the detector still catches same-turn tool/command evidence, but a
  hidden external cron cannot be proven from prose alone. Wire the Stop hook where durable
  cron/loop state is available.
- The Stop hook scans task-state files with hard bounds and fail-open behavior; it does not
  run `CronList`, call BrainLayer, or spawn subprocesses.

## Provenance

RED north-star: the gen-10 dawn incident — health-watch / status cron left firing all night
after the fleet had effectively wrapped ("Why didn't you stop?"), pinned in MEMORY as 2×
imp-10 ledger rows. Evasion REDs: disguised-as-inbound-monitor, only-an-Etan-decision-pending,
back-to-silent poll loop, narrative-only health-watch, schedule_task tool variant,
standby-without-the-word-"wrap" + health-watch (inbound posture is terminal too),
cron-tool-narrated-away (prose "no crons" over a real CronCreate), delete-old +
create-new-health-watch (a clear of some OTHER cron does not excuse a fresh poller),
for/seq poll loop with a non-"i" loop variable, multiple-CronCreates-as-"one-inbound-monitor"
(one-monitor law), a health-watch hidden in the CronCreate payload, delete-old +
create-new-GENERIC-cron (a CronDelete does not clear a freshly-created cron), a narrative-only
`/loop` admission, wrap-plus-"more-work-queued" + CronCreate (a strong wrap marker + an
armed cron is evaluated, not escaped as mid-sprint), and a generic recurring job (nightly
digest / fleet driver) relabeled "one inbound monitor" (the inbound payload must match the
inbound claim). GREEN
references: crons-cleared + one-inbound-monitor, mid-sprint N/A, TaskStop-no-monitor, plain
status line, stand-down awaiting-Etan inbound-only.
