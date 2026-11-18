# Claude worker permission hook

Status: implemented; installed with the Claude hook set (`install-hooks --host mbp|client`).

## Problem

T3 Code runs a full-access Claude thread as `permissionMode: "bypassPermissions"`
with an SDK `canUseTool` callback. Claude Code still asks when its built-in check
can't vouch for a shell line (for example a zsh `${(f)"$(…)"}` split). T3 turns
the ask into an approval card that waits with no time limit, so an unattended
worker stalls until someone notices. No golems PreToolUse hook answers "ask"; the
ask comes from Claude Code itself.

The Codex half is handled by `codex-policy-hook.py permission-request`
([codex-policy-hooks.md](codex-policy-hooks.md)). This is the Claude half.

## What it does

`scripts/hooks/claude-worker-permission.py` is registered for Claude's
`PermissionRequest` event on every host, with no matcher (all tools), through
the fail-open launcher (`golems-fail-open.py`, no `--fail-closed`), timeout 5 s.

- **Worker:** the hook prints
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":…}}}`
  with this message: "This step needs a person's approval, and this worker runs
  unattended. Do it another way that needs no approval (for a shell step:
  Edit/Write tools, or one plain literal command, or a script file you run), or
  report BLOCKED to your lead with exactly what you needed."
- **Anything else:** it prints nothing. Claude asks a person, as it would
  without the hook.

The hook only ever refuses. It never prints `allow`, so its worst case is a
refused step, never a wrong approval.

### Who counts as a worker

T3 sets `T3CODE_THREAD_ID` for every Claude session it runs. The environment
otherwise looks the same for a lead and a worker (`CLAUDE_CODE_CHILD_SESSION=1`
and `CLAUDE_CODE_SESSION_ATTENDED=0` in both), so the thread record decides:

1. An id starting `thread:delegated-task:` is a delegated child. No lookup.
2. Any other id is looked up in T3's state DB (`~/.t3/userdata/statev2.sqlite`,
   opened `mode=ro&immutable=1`), table `orchestration_v2_projection_threads`,
   column `payload_json`:
   - `delegatedFrom` is a JSON object (a thread launched for a lead) → worker;
   - `lineage.parentThreadId` is a non-empty string **and** `createdBy` is not
     `"user"` (an agent-made child or fork) → worker;
   - otherwise not. A fork or side chat the user opened has a parent but is
     attended, so it keeps asking.
3. No id, no DB, no row, malformed JSON or any SQLite error → not a worker.

So a worker is recognised **only** when it was delegated (`delegate_task`), has
a parent thread, or was launched with `delegatedFrom`. Nothing else is
inferred: titles are not read, because a lead that orc launched has the same
shape as a worker.

**Leads must always pass `delegatedFrom` when they launch a worker** with
`t3_thread_launch`. A worker launched without it is a top-level,
agent-created thread with no parent. To this hook it is indistinguishable
from a lead, so it keeps raising approval cards. On 18 Nov 2026, 18 of 25
recent Claude `t3_thread_launch` threads had no `delegatedFrom` (mock and
trial workers, one real worker).

### A worker the owner joins is still refused

The check reads how the thread was created, not who is typing in it now. If
the owner writes into a worker thread, a step that needs approval is still
refused, and the model reports BLOCKED instead of asking him. To approve such
a step himself, the owner runs it from his own lead or terminal session.

### Fail open, on purpose

A failure must restore today's behaviour (a person is asked), never deny a
lead's or terminal session's request:

- the hook runs under the fail-open launcher (no `--fail-closed`), and every
  lookup failure means "not a worker";
- the installer wraps every `PermissionRequest` command in a `/bin/sh` guard
  (`permissionGuardCommand` in `install-hooks.mjs`, used by the release
  installer too). It prints the hook's output only when the hook exits 0, and
  always exits 0. Without it, a missing launcher copy or a dangling hook link
  makes `python3` exit 2, and Claude reads exit 2 on this event as a denial in
  **every** session, leads included;
- both installers refuse a `--fail-closed` `PermissionRequest` entry.

`GOLEMS_T3_STATE_DB` overrides the DB path for tests only; a bad value is just
another failed lookup.

## Limits

- **The card still flashes.** On T3's path Claude Code starts the hook and the
  SDK `canUseTool` callback concurrently and takes the first answer. The hook
  answers in about 150 ms; the SDK then aborts the callback, and T3 withdraws
  the pending request. T3 has already created the card by then, and its
  notification path fires on a new approval at once (see
  [the proof note](proofs/claude-permission-request.md#what-t3-does-with-the-short-lived-request)).
  The worker never waits; removing the flash needs a change in T3 itself.
- **WAL lag.** `immutable=1` reads only the main DB file. A thread whose row is
  still only in T3's write-ahead log reads as "not a worker" (fail open) until
  T3 checkpoints.
- **Scope.** All tools that would prompt are covered, including MCP tools,
  questions and plan-mode exits, so the message is general rather than
  shell-only. A worker that would otherwise ask the owner through a permission
  prompt is told to report to its lead instead.
- **Coverage.** Only workers recognisable from their thread record are caught
  (see "Who counts as a worker"). A `t3_thread_launch` worker without
  `delegatedFrom` still raises cards.

## Verify

```bash
python3 -m unittest scripts/tests/test_claude_worker_permission.py
bun test scripts/tests/install-hooks.test.mjs -t 'worker|PermissionRequest'
bun test scripts/tests/release-hooks.test.mjs -t 'PermissionRequest'
node scripts/hooks/install-hooks.mjs --host mbp --status   # expect: worker-permission ok
```

Live receipt: [proofs/claude-permission-request.md](proofs/claude-permission-request.md).
