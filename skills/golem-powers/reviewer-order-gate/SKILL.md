---
name: reviewer-order-gate
description: "PreToolUse guard: a cmux reviewer spawn is denied until the implementer is done. Triggers: reviewer order, implementer done, reviewer spawn denied."
disable-model-invocation: true
---

# Skill: Reviewer-Order Gate

> The implementer goes first. A reviewer starts only when the implementer says it is done.
> (Etan, 2026-09-27, `~/.claude/CLAUDE.md` § Merging.)

## What It Enforces

A Claude Code **PreToolUse** hook on `mcp__cmux(layer)?__spawn_agent`. It acts only
when `tool_input.role` is `"reviewer"`; every other spawn passes untouched.

The boot brief is the inline `prompt`, or the file at `boot_prompt_path`, plus any
file the brief points at with `Read and follow <path>` (one level deep).
The spawn is **allowed** when the brief cites either:

| Evidence | Allowed when |
|---|---|
| (a) an implementer report path | the file's last non-empty line is a `DONE_<ID>` marker |
| (b) a GitHub PR: URL, `owner/repo#N`, or bare `#N` | the PR is OPEN and every check on its head has completed (`gh pr view --json statusCheckRollup`) |
| (b) on a cloud-session branch (`claude/…`) | as above, and the head commit is ≥10 min old. Cloud sessions write no DONE marker, so for them done = head stable ≥10 min + checks finished |

Completed means finished, not green: a failed check still counts as completed.
A PR with no checks reported yet, a merged or closed PR, or a PR not found is
not evidence. A bare `#N` resolves against the spawn's `cwd` (then the hook's cwd).

Otherwise the spawn is **denied** with `permissionDecision: "deny"` and a one-line
reason: `REVIEWER-ORDER-GATE: implementer not done — <what was missing>`.

## Fail-Open

The gate never blocks on its own failure. Missing `gh`, a `gh` timeout, a `gh`
error other than "PR not found", unparseable output, an unreadable
`boot_prompt_path`, or malformed hook input all allow the spawn and add
`additionalContext` starting `REVIEWER-ORDER-GATE advisory:`.

All `gh` calls share one 3.5 s budget (`REVIEWER_ORDER_GATE_GH_BUDGET_MS`) and at
most three PR references are checked, so the hook stays inside its 5 s manifest
timeout. Measured live on 2026-09-27: about 0.5–0.7 s per PR check.

## Output Schema

- allow, or not a reviewer spawn: `{}`
- deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"REVIEWER-ORDER-GATE: implementer not done — ..."}}`
- fail-open: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"REVIEWER-ORDER-GATE advisory: ..."}}`

## Install

Registered in `scripts/hooks/manifest.json` for the `mbp` and `m1` hosts, next to
`model-pin-gate`, with `timeout: 5`. The hook installer wires it; nothing else to do.

## Run It

```bash
bun test skills/golem-powers/reviewer-order-gate/evals/
```

The suite replays `evals/fixtures/*.json` through the real hook with `gh` stubbed
on `PATH`. It makes no network calls.

## Known Gaps

- **`send_to` is not gated.** Queueing a new PR to an already-running reviewer
  with `send_to` bypasses this gate; the lead's discipline covers that case. The
  structural fix is a cmuxlayer `spawn_agent({..., after_done: <agent_id>})`
  primitive, worth building only if this gate fires often.
- **Any cited evidence counts.** The gate checks that the brief cites a done
  report or a finished PR, not that it is the PR under review. A brief that
  mentions an unrelated open PR with finished checks passes.
- **Head age is the commit date.** For cloud branches, "stable ≥10 min" uses the
  head commit's `committedDate` as a stand-in for push time.
