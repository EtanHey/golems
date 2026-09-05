---
name: collab-routing-gate
description: "Collab-first routing gate. Triggers: cross-lead coordination, worker monitoring, async decision."
disable-model-invocation: true
---

# Skill: Collab-Routing Gate (gen-18 Track 1 #4)

> Coordination flows through the append-only collab file + event-driven waits — NOT send_input chatter,
> sleep-poll loops, or bare decision-questions. Mechanizes R-002's substrate (gen-16 ROOT-1
> "why not update the shared coordination log once for everyone").

## Scope

No send_input coordination, no sleep-poll ticks, and decisions carry a recommendation.

## What It Is

A deterministic detector over a lead/orc transcript. The pinned RED/GREEN fixtures ARE the replayable gate.

| Code | What it catches |
|---|---|
| `SLEEP_POLL_TICK` | a sleep-loop polling a worker's progress (read_screen/get_agent_state) instead of `wait_for(agent_id)` / `Monitor` |
| `COORD_VIA_SEND_INPUT` | `send_input`/`send_key` carrying cross-lead coordination prose (status pings / @mentions) instead of a collab append |
| `DECISION_WITHOUT_RECOMMENDATION` | an async decision posted to collab as a bare question with no recommendation |

GREEN: event-driven `wait_for`/`Monitor`; cross-lead comms via an append-only collab post; a decision posted
WITH a recommendation; `send_input` used to BOOT a worker with its task (not coordination chatter).

## How /orc Consumes It

Backs the collab-first doctrine: collab = append-only md + fswatch (NOT a message bus driven by send_input);
per-wave checkpoint cadence (≥1 collab append between wave outputs); async decision → collab line WITH a
recommendation; never AskUserQuestion for coordination (see also `/idle-dwell-gate`); never sleep-poll a tick.

```bash
bun test skills/golem-powers/collab-routing-gate/evals/collab-routing-gate.test.mjs
bun skills/golem-powers/collab-routing-gate/scripts/collab-routing-gate-cli.mjs <transcript|->   # exit 3 = FLAG
```

## Stated Limits

Marker-anchored; distinguishes a worker BOOT prompt from COORDINATION prose by content markers. New evasion
shapes are pinned as RED fixtures (R-003 model).
