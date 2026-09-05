---
name: monitor-law-gate
description: "Mechanical monitor-law gate: assert a persistent monitor is armed on the ACTIVE collab channel with a heartbeat marker. Triggers: lead/orc sprint, spawn workers, 'back to silent'."
disable-model-invocation: true
---

# Skill: Monitor-Law Gate (gen-18 Track 1 #2)

> Fleet law: canon #7 owns claim/guard/DONE/harvest-close. This skill is the deterministic monitor/collab enforcement gate.

## What It Is

A deterministic detector over a lead/orchestrator transcript: when there is in-flight work (spawned
workers) and an active collab channel, it asserts a **persistent monitor is armed ON the active channel**
and **keyed to a real heartbeat marker** (`### ` / `ORC-RECEIPT:` / `@name` / `BLOCKED`). The pinned
RED/GREEN fixtures ARE the replayable gate (R-003/R-014 pattern).

The detector must not accept a prose claim like `monitor=X` as proof. When heartbeat or registry ground
truth is available, the claimed monitor id is checked against it: stale heartbeat, missing id, or a live
heartbeat on the wrong collab file is a FLAG. Same-turn `Monitor`/`tail -f` evidence still proves the
monitor shape; registry/heartbeat evidence proves liveness.

## Registry-Polling Doctrine (2026-07-02)

After three same-day monitor-death cascades (model flips and app restarts left registry agents
`inbox_monitor_not_alive` while completed workers sat unharvested), worker-completion watching must be
**registry-polling**, not session-tail based.

- Completion detection polls durable ground truth: `list_agents state=done` and/or registry state files.
- Session-scoped inbox heartbeats and tail monitors are not completion detectors; they die with model flips
  and app restarts, leaving the lead idle-and-blind while believing it is armed.
- Persistent collab monitors remain required for inbound coordination on the active channel. They catch new
  posts, blockers, and receipts, but they do not replace registry polling for worker completion.
- A lane that is stood down with disclosure and acknowledgement, with no active sprint and no live workers
  remaining in the registry, is allowed to have `monitor=none`.

## Violation Taxonomy

| Code | What it catches |
|---|---|
| `MONITOR_ABSENT` | spawned workers + active channel but NO monitor/watch armed (the "back to silent" no-op) |
| `MONITOR_WRONG_CHANNEL` | a monitor armed on a side/Q&A collab while the squad posts to the active channel |
| `MONITOR_NO_MARKER` | a monitor on the right channel but keyed to no heartbeat marker — it never fires |
| `MONITOR_NOT_PERSISTENT` | a one-shot monitor or bounded `timeout tail -f` is claimed as the go-silent watch |
| `MONITOR_STALE_HEARTBEAT` | `monitor=X` is absent from ground truth or has no fresh heartbeat in its window |

GREEN: a persistent `Monitor` (or `tail -f … | grep` backstop) on the active channel keyed to
`^### |ORC-RECEIPT:|@<name>|BLOCKED` with live heartbeat/registry proof when a monitor id is claimed; or
no in-flight lead/orc work (N/A). Worker seats, monitor-policy discussion, and disclosed/acked stand-down
states are false-positive guards.

## How /orc Consumes It

This backs `/orc`'s SECOND CARDINAL RULE ("arm an inbound monitor first"). Before a lead/orc ends its
first sprint turn — after spawning any worker — run the gate on the turn. A FLAG means: arm a persistent
monitor on the ACTIVE channel keyed to the heartbeat marker BEFORE going quiet. The orchestrator may pass
`{ activeChannel: "<path>" }` when it knows the channel authoritatively.

```bash
bun test skills/golem-powers/monitor-law-gate/evals/monitor-law-gate.test.mjs
python3 skills/golem-powers/monitor-law-gate/evals/run_suite.py
bun skills/golem-powers/monitor-law-gate/scripts/monitor-law-gate-cli.mjs <transcript.jsonl|->   # exit 3 = FLAG
```

Programmatic: `import { detectMonitorLaw } from "./src/monitor-law-gate.mjs"` → `{ verdict, violations, activeChannel, monitors, inFlight }`.

Hook wiring uses `scripts/monitor-law-gate-hook.mjs` as a Claude Code Stop hook. The hook is local-only:
bounded stdin/path reads, no subprocesses, no network, no BrainLayer, fail-open on malformed input or
internal errors. Stdout schema is exactly `{}` to allow, `{"decision":"block","reason":"..."}` to block,
or `{"systemMessage":"..."}` for advisory fail-open conditions. Install with the checked-in
`install-snippet.json`; it pins the absolute Node path because the fleet-wide bare `node` shim is not
trusted for hooks.

## Stated Limits

Marker-anchored over the turn's tool calls; the active channel is inferred from the collab path the agent
posts to / dispatches about unless the caller forces `opts.activeChannel`. New evasion shapes are pinned as
RED fixtures (R-003 model).
