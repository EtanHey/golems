---
name: model-pin-gate
description: "PreToolUse model-pin guard for Fable seats: Agent/Task spawns must pin a non-Fable model; Workflow agent() pins are advisory. Triggers: model pin, Fable seat, Agent spawn, Workflow spawn."
disable-model-invocation: true
---

# Skill: Model-Pin Gate

> Fleet law: canon #5 owns model policy. This skill is the Claude Code hook that enforces Fable-seat spawn pins.

## What It Is

`model-pin-gate` is a Claude Code **PreToolUse** hook for `Task|Agent|Workflow`.
It reads the current session's recent assistant model from `transcript_path` with
a bounded tail read. If the current seat is not detectable as Fable, the hook
allows the tool call. If the current seat is Fable, it enforces Etan's 2026-07-02
fleet model policy:

| Tool call from a Fable seat | Verdict |
|---|---|
| `Agent` or `Task` without `tool_input.model` | BLOCK: `MODELPIN_AGENT_UNPINNED` |
| `Agent` or `Task` pinned to a Fable model | BLOCK: `MODELPIN_FABLE_BELOW_APEX` |
| `Agent` or `Task` pinned to a non-Fable model (`opus`, `sonnet`, `haiku`, or another explicit non-Fable model) | PASS |
| `Workflow` script with `agent(` calls and fewer `model:` pins than `agent(` calls | ADVISORY: `MODELPIN_WORKFLOW_AGENT_MODEL_ADVISORY` |
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

- Seat-model detection depends on a recent assistant `model` field in the
  transcript. If the model is absent or unreadable, the gate allows the call.
- Workflow checks are advisory-only by design. They are a cheap reminder to pin
  each `agent()` call and avoid brittle parsing in a hot hook path.
