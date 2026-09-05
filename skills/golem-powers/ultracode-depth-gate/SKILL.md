---
name: ultracode-depth-gate
description: Deterministic gate for ultracode/comprehensive workflow topology depth floors. Triggers: ultracode, exhaustive audit, deep fan-out, workflow topology, persistent collab.
---

# Ultracode Depth Gate

Use this gate before accepting or ending an `ultracode`, comprehensive, exhaustive, or audit-style fan-out dispatch.

The gate is deterministic and replay-based:

```bash
bun skills/golem-powers/ultracode-depth-gate/scripts/ultracode-depth-gate-cli.mjs < transcript.jsonl
bun skills/golem-powers/ultracode-depth-gate/scripts/ultracode-depth-gate-cli.mjs fixture.json
cat transcript.jsonl | bun skills/golem-powers/ultracode-depth-gate/scripts/ultracode-depth-gate-cli.mjs -
```

Exit codes:

- `0` = PASS
- `3` = FLAG
- `2` = usage / parse error

## Doctrine

For ultracode/comprehensive fan-out work:

- Dispatch at least 17 cheap-model gatherers.
- Dispatch at least 3 adversarial verifiers.
- Avoid flat N-to-1 single-pass topology; include adversarial verification and loop-until-dry.
- Stop on quality / dry convergence, not a budget or token cap.
- Route persistent-agents + collab work through `large-plan:collab`, not one-shot explorers.

## Evidence Rule

Counts and clearance come only from tool calls and tool_result outputs in the current turn:

- `spawn_agent`, `Task`, `parallel`, `agent(...)`, `Workflow`, and `large-plan:collab` calls.
- Inline Workflow scripts inside tool inputs.
- Tool_result outputs confirming counts or stop semantics.

Assistant prose can describe intent, but it cannot satisfy gatherer/verifier floors, routing, or quality-stop evidence.
