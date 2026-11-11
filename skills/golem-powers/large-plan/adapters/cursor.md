# Cursor CLI — large-plan Adapter

> Platform-specific syntax for large-plan research and audit phases with Cursor.

## Research Phase

`@codebase` gives Cursor whole-repo semantic context — best for codebase-wide research phases:

T3 `delegate_task` with `target: {providerInstanceId: "cursor", model: "default"}` (Auto). Write one brief file per child; dispatch `Read and follow <absolute brief path>`. Each brief says `Report to <collab path>, not to the lead thread.` Never use a headless CLI, AutoCursor runner, or background Cursor loop. Never select a named Cursor model; `default` is the T3 Auto sentinel.

## Phase Audit (Before Push)

T3 `delegate_task` with `target: {providerInstanceId: "cursor", model: "default"}` (Auto). Write one brief file per child; dispatch `Read and follow <absolute brief path>`. Each brief says `Report to <collab path>, not to the lead thread.` Never use a headless CLI, AutoCursor runner, or background Cursor loop. Never select a named Cursor model; `default` is the T3 Auto sentinel.

Cursor model selection is owned by fleet canon #1.

## Worktree Setup (Manual)

Use the [canonical worktree launch guard](../../agent-routing/references/worktree-launch.md)
to verify the actual project root and base commit. In T3 use managed isolation;
outside T3 pass the receipt's commit OID to authorized manual worktree creation.
For Cursor, use managed T3 isolation when needed; never launch a shell Cursor worker.

## PR Review (Bugbot)

After pushing a phase PR, trigger review as a PR comment:

```
@cursor @bugbot review
```

Re-review after fixes: `@cursor @bugbot re-review`

## Always Verify Cursor Findings

Cursor can report gitignored or untracked files as "committed":

```bash
# Is this file actually git-tracked?
git ls-files -- <path>           # empty = not tracked

# Was this secret ever committed?
git log --all -- <path>          # empty = never in history
```

## Limitations

- No subagent spawning
- No session resume
- No MCP access — write findings to markdown files
- No CronCreate / /loop
- Findings need manual git verification before acting on them
