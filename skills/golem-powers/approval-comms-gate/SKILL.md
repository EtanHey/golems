---
name: approval-comms-gate
description: "Mechanical gate for visual approval routing, in-policy PR admin-merge, and incident framing-first doctrine. Triggers: visual/design approval, CI-green in-policy PR, incident/operator response."
disable-model-invocation: true
---

# Skill: Approval + Comms Gate (gen-18 Track 1 #7)

This is a deterministic transcript gate for three orc/lead communication failures:

- `VISUAL_GATE_WRONG_CHANNEL`: a visual/design approval gate is routed to dead `outbox.md` or scattered
  markdown instead of the live operator channel.
- `INPOLICY_PR_PARKED`: a CI-green in-policy PR is parked for Etan merge approval instead of admin-merged.
- `INCIDENT_FRAMING_LAST`: an incident/operator response leads with stack/code/log detail before the
  plain-English framing.

## Required Evidence

Evidence that clears a gate must come from the current turn's tool calls and tool results:

- Visual approval: same-turn `SendUserFile` plus Telegram bot/API delivery with `ok=true`.
- PR merge: same-turn `gh pr merge <N> --admin ...` plus merge success output.
- Incident response: the first assistant text starts with the operator framing, not a stack/log/code path.

Assistant prose cannot satisfy delivery/merge evidence. `outbox.md` is not a live delivery channel.

## Run It

```bash
bun test skills/golem-powers/approval-comms-gate/evals/
bun skills/golem-powers/approval-comms-gate/scripts/approval-comms-gate-cli.mjs <transcript.jsonl|->
```

Exit `3` means FLAG. The pinned RED/GREEN fixtures are the replayable gate.

## Provenance

RED specimens: R-004 outbox.md append-void, orchestrator/08b58309#1 admin-merge parking,
da456dfd#3/#4/#9 incident framing-last. GREEN references: SendUserFile + Telegram `ok=true`,
in-policy PR admin-merged, incident framing first, and no-approval/no-incident N/A.
