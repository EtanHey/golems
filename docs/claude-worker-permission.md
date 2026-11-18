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
  with an actionable message: do it another way (Edit/Write instead of a shell
  edit, one plain literal command, no `rm -f`), or report BLOCKED to the lead
  with the exact command.
- **Anything else:** it prints nothing. Claude asks a person, as it would
  without the hook.

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

### Fail open, on purpose

A failure must restore today's behaviour (a person is asked), never deny a
lead's or terminal session's request. So the hook runs under the fail-open
launcher, and every lookup failure means "not a worker". `GOLEMS_T3_STATE_DB`
overrides the DB path for tests only; a bad value is just another failed lookup.

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
- **Scope.** All tools that would prompt are covered, including MCP tools. A
  worker that would otherwise ask the owner a question through a permission
  prompt is told to report to its lead instead.

## Verify

```bash
python3 -m pytest -q scripts/tests/test_claude_worker_permission.py
bun test scripts/tests/install-hooks.test.mjs -t 'worker'
node scripts/hooks/install-hooks.mjs --host mbp --status   # expect: worker-permission ok
```

Live receipt: [proofs/claude-permission-request.md](proofs/claude-permission-request.md).
