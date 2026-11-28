---
name: model-pin-gate
description: "PreToolUse guard: unpinned Fable-seat spawns and sub-apex Fable targets block. Triggers: model pin, Fable seat, spawn."
disable-model-invocation: true
---

# Skill: Model-Pin Gate

> Every spawn pins its model explicitly (canon #5); a non-default model such as Fable is used only by explicit per-invocation selection, never inherited. Routing: see `/agent-routing` § Routing rules (SSOT).

## What It Is

`model-pin-gate` is a Claude Code **PreToolUse** hook for `Task|Agent|Workflow`
and, with the prepared settings matcher, cmux `spawn_agent`, `dispatch_to_agent`,
legacy repoGolem pane launches, and T3 `delegate_task` (both `t3-code` and `t3_code` MCP names).
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
| explicit Fable target from `orchestrator`, `orc`, or `skillcreatorLead` | PASS for separate seats |
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

Owner-requested advisor routing: see `/agent-routing` § Lead Topology #8.

## T3 seat identity

T3's Claude adapter supplies `T3CODE_THREAD_ID` in the Claude process environment
and starts the SDK at the thread cwd. The wrapper passes that environment id and
its actual cwd separately from tool input. For T3 sessions, payload/input seat
claims and Fable-model inference grant no authority. A lead requires a nonempty,
non-`thread:delegated-task:` id, equal canonical payload/process cwd, and a `.git`
directory at one of the exact apex checkout roots mapped in the detector.
Linked worktrees have a `.git` file and
are refused; arbitrary root checkouts and unknown sessions gain no apex status.
Missing filesystem evidence grants no T3 lead privilege.

These roots mirror the existing APEX_SEATS and fleet registry, not every T3
project. This is a same-user policy guard, not authenticated thread identity:
a worker with arbitrary shell access can change cwd and environment and run the
hook manually. An unprefixed delegated session deliberately launched at an apex
root is also indistinguishable here. T3 state/lineage authentication is not
claimed. Owner intent is enforced by routing instructions, not inferred from a
tool's task text. `detectModelPin(payload, context)` accepts trusted wrapper
context for deterministic replay; payload fields cannot supply it.

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
Caught failures emit a visible advisory that the check could not run; the action
is still allowed and exception details are omitted.

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
- Separate-seat Fable targets require an apex identifier outside T3, or the T3
  identity checks above. T3 delegates always require T3 identity; legacy seat
  claims and transcript inference cannot authorize an explicit delegate target.
- Workflow checks are advisory-only by design. They are a cheap reminder to pin
  each `agent()` call and avoid brittle parsing in a hot hook path.

For Fable-seat delegates, only `target.model` counts as an explicit pin. Missing
provider, claudeAgent, claude-eval, and unknown instance aliases require it: the
hook has no dynamic provider catalog and treats unknown aliases as potentially
Claude-backed. Known Codex, Cursor and Antigravity instance names keep their
other-provider behavior. A missing transcript model still limits inheritance
detection as described above.

A nested `claude -p` inherits T3CODE_THREAD_ID and cwd from a T3 lead, so those
signals alone cannot distinguish it from that lead at an apex root. A real
nested CLI started with entrypoint `t3-code` retained that value in its
SessionStart hook. CLAUDE_CODE_ENTRYPOINT therefore does not distinguish that
nested CLI from the parent, and is not used as an authority check. A nested CLI
at an apex root may still gain the parent's cmux seat privilege; the same-user
policy limitation remains.
