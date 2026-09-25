---
name: model-pin-gate
description: "PreToolUse guard: unpinned Fable-seat spawns and sub-apex Fable targets block. Triggers: model pin, Fable seat, spawn."
disable-model-invocation: true
---

# Skill: Model-Pin Gate

> Fable is apex-only. Worker fan-out should name the model it needs instead of inheriting or targeting Fable by accident.

## What It Is

`model-pin-gate` is a Claude Code **PreToolUse** hook for `Task|Agent|Workflow`
and, with the prepared settings matcher, cmux `spawn_agent`, `dispatch_to_agent`,
and repoGolem-style `new_split` launches.
It reads the current session's recent assistant model from `transcript_path` with
a bounded tail read. It also honors explicit apex-seat identifiers
(`orchestrator`, `orc`, `skillcreatorLead`) when a caller deliberately targets
Fable.

The hook enforces Etan's fleet model policy:

| Spawn surface | Verdict |
|---|---|
| `Agent` or `Task` without `tool_input.model` | BLOCK: `MODELPIN_AGENT_UNPINNED` |
| `Agent`, `Task`, or `Workflow` explicitly targeting Fable from a non-apex seat | BLOCK: `MODELPIN_FABLE_BELOW_APEX` |
| cmux `spawn_agent`, `dispatch_to_agent`, or `new_split` targeting Fable from a non-apex seat | BLOCK: `MODELPIN_CMUX_FABLE_TARGET` |
| explicit Fable target from `orchestrator`, `orc`, or `skillcreatorLead` | PASS |
| explicit non-Fable model (`opus`, `sonnet`, `haiku`, or another explicit non-Fable model) | PASS |
| `Workflow` script with `agent(` calls and fewer `model:` pins than `agent(` calls | ADVISORY: `MODELPIN_WORKFLOW_AGENT_MODEL_ADVISORY` |
| `Workflow` script with unpinned `agent(` calls, after `WEEKLY_RESET_AT` (2026-09-06T02:05Z = ~05:05 IDT, Etan 8A) | FLAG: `MODELPIN_WORKFLOW_AGENT_UNPINNED` |
| `Workflow` script pins Fable, apex seat, before `WEEKLY_RESET_AT` | ADVISORY: `MODELPIN_FABLE_IN_WORKFLOW` (Etan 2026-09-05 amnesty) |
| `Workflow` script pins Fable, any seat, after `WEEKLY_RESET_AT` | FLAG: `MODELPIN_FABLE_IN_WORKFLOW` (07-18 law) |
| `Agent`/`Task` pins Fable from an apex seat, before / after `WEEKLY_RESET_AT` | ADVISORY / FLAG: `MODELPIN_FABLE_SUBAGENT` |
| `Agent`/`Task`/`Workflow` targets Fable from a non-apex seat (any date) | FLAG: `MODELPIN_FABLE_BELOW_APEX` |
| `Workflow` script with enough `model:` pins | PASS |
| unrelated tools, malformed payloads, missing/undetectable seat model | PASS fail-open |

The Workflow path is intentionally heuristic and advisory-only. It counts
`agent(` occurrences versus `model:` occurrences and does not attempt full
JavaScript parsing inside a 500ms hook.

## Hook Contract

Input is the Claude Code PreToolUse stdin payload:

```json
{
  "hook_event_name": "PreToolUse",
  "transcript_path": "/path/to/transcript.jsonl",
  "tool_name": "Agent",
  "seat_id": "skillcreatorWorker",
  "tool_input": { "model": "opus", "prompt": "..." }
}
```

Output schema:

- allow: `{}`
- block: `{"decision":"block","reason":"..."}`
- advisory: `{"systemMessage":"..."}`

The hook is local-only: no network, no BrainLayer, no subprocesses, bounded
stdin/transcript reads, and fail-open on malformed input or internal errors.

`install-snippet.json` pins the absolute Node path:
`$HOME/.nvm/versions/node/v22.22.0/bin/node`.

## Run It

```bash
bun test skills/golem-powers/model-pin-gate/evals/model-pin-gate.test.mjs
python3 skills/golem-powers/model-pin-gate/evals/run_suite.py
```

Programmatic: `import { detectModelPin } from "./src/model-pin-gate.mjs"` →
`detectModelPin(payload)` returns `{ verdict, seatModel, tool, violations, advisories }`.

## Stated Limits

- Unpinned inheritance detection depends on a recent assistant `model` field in
  the transcript. If the model is absent or unreadable and no explicit Fable
  target is present, the gate allows the call.
- Explicit Fable targets are allowed only when the payload carries an apex seat
  identifier. Unknown seat identifiers are treated as non-apex for explicit
  Fable targets.
- Workflow checks are advisory-only by design. They are a cheap reminder to pin
  each `agent()` call and avoid brittle parsing in a hot hook path.
