---
name: reviewer-order-gate
description: "PreToolUse guard: reviewer spawns denied until the implementer is done. Triggers: reviewer order, reviewer spawn."
disable-model-invocation: true
---

# Skill: Reviewer-Order Gate

> The implementer goes first. A reviewer starts only when the implementer says it is done.
> (Etan, 2026-09-27, `~/.claude/CLAUDE.md` § Merging.)

## What It Enforces

A Claude Code **PreToolUse** hook on `mcp__cmux(layer)?__spawn_agent`. It acts only
when `tool_input.role` is exactly `"reviewer"` (no case or whitespace folding);
every other spawn passes untouched.

The boot brief is the inline `prompt`, or the file at `boot_prompt_path`, plus any
file the brief points at with `Read and follow <path>` (one level deep).
The spawn is **allowed** when the brief cites either:

| Evidence | Allowed when |
|---|---|
| (a) an implementer report path | the file's last non-empty line is a `DONE_<ID>` marker |
| (b) a GitHub PR: URL, `owner/repo#N`, or bare `#N` | the PR is OPEN and every check on its head has completed (`gh pr view --json statusCheckRollup`) |
| (b) on a cloud-session branch (`claude/…`) | as above, and the head commit is ≥10 min old. Cloud sessions write no DONE marker, so for them done = head stable ≥10 min + checks finished |

**Every PR the brief cites must be finished** (golemsLead ruling, #296 R1). One
cited PR with running or queued checks, no checks reported yet, or a fresh cloud
head denies the spawn, even when another cited PR or a DONE report would allow it.
Merged, closed, and not-found PRs neither allow nor block. A merged PR can still
show a pending check after merge, so state is decided before checks.

Completed means finished, not green: a failed check still counts as completed.
A bare `#N` resolves against the spawn's `cwd` (then the hook's cwd).

Reports are read from their last 256 KiB; a tail that starts mid-line drops that
partial line, so a marker is only trusted on a whole line. Briefs are read whole,
up to 1 MiB.

Otherwise the spawn is **denied** with `permissionDecision: "deny"` and a one-line
reason: `REVIEWER-ORDER-GATE: implementer not done — <what was missing>`.

## Fail-Open

The gate never blocks on its own failure. Each of these allows the spawn and adds
`additionalContext` starting `REVIEWER-ORDER-GATE advisory:`:
- missing `gh`, a `gh` timeout, a `gh` error other than "PR not found", or
  unparseable output;
- an unreadable brief file, or a brief over 1 MiB;
- a brief citing more than six PRs, which cannot all be checked in time;
- malformed hook input.

All `gh` calls share one budget (`REVIEWER_ORDER_GATE_GH_BUDGET_MS`, default and
ceiling 3.5 s). A timed-out `gh` is sent SIGKILL, because SIGTERM can be ignored.
That keeps the hook inside its 5 s manifest timeout. Measured live on
2026-09-27: about 0.5–0.7 s per PR check.

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
on `PATH`. It makes no network calls. With the hook file absent, as on master
before this gate, the harness reports the ungated result `{}` for every fixture.
That is the behavioural RED: every DENY and ADVISORY fixture fails.

## Known Gaps

- **`send_to` is not gated.** Queueing a new PR to an already-running reviewer
  with `send_to` bypasses this gate; the lead's discipline covers that case. The
  structural fix is a cmuxlayer `spawn_agent({..., after_done: <agent_id>})`
  primitive, worth building only if this gate fires often.
- **Evidence is not bound to the review target.** Every cited PR must be
  finished, so a running target PR always denies. But a brief that cites only an
  unrelated finished PR, and never names the real target, still passes.
- **Head age is the commit date.** For cloud branches, "stable ≥10 min" uses the
  head commit's `committedDate` as a stand-in for push time.
