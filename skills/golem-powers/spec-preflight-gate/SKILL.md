---
name: spec-preflight-gate
description: Deterministic gate for spawn/dispatch briefs that reference spec or handoff files. Triggers: spawn hygiene, assert-before-spawn, handoff brief, spec path preflight.
---

# Spec Preflight Gate

Use this gate before accepting or ending a spawn/dispatch turn that routes work from a spec, plan, or handoff file.

The gate is deterministic and replay-based:

```bash
bun skills/golem-powers/spec-preflight-gate/scripts/spec-preflight-gate-cli.mjs < transcript.jsonl
bun skills/golem-powers/spec-preflight-gate/scripts/spec-preflight-gate-cli.mjs fixture.json
cat transcript.jsonl | bun skills/golem-powers/spec-preflight-gate/scripts/spec-preflight-gate-cli.mjs -
```

Exit codes:

- `0` = PASS
- `3` = FLAG
- `2` = usage / parse error

## Doctrine

For spawn/dispatch briefs:

- Assert every referenced spec/handoff path exists before dispatching from it.
- Brief from grep-patterns and structural invariants, not a load-bearing exact filename.
- Keep seat identity consistent across `name`, `repo`, `launcher`, and "you are ..." prompt text.
- Try user-space setup workarounds before declaring an install blocker human-only.

## Evidence Rule

Clearance comes only from tool calls and tool_result outputs in the current turn:

- Dispatch calls: `spawn_agent`, `Task`, `send_to`, `send_to_agent`, `agent`, and `parallel`.
- Spec checks: earlier `Read`, `cat`, `ls`, `test -f`, `grep`, `stat`, or similar file probes of the exact path.
- Workarounds: visible `--appdir`, `~/Applications`, `$HOME`, `shared.env`, `--user`, `--no-sudo`, or user-space install paths before the blocker output.

Assistant prose can state intent, but it cannot verify a path, clear identity drift, or prove a workaround was attempted.
