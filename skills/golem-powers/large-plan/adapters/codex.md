# Codex CLI — large-plan Adapter

> Platform-specific syntax for executing large-plan phases with Codex.
> Codex v0.111.0+. Binary at `~/.bun/bin/codex`.

## Phase Execution

Choose the Codex model and effort through `/agent-routing` `references/model-and-effort.md` § Decide From the Mission.

```bash
# Run a phase in full-auto mode from a worktree
cd ../wt-phase-<N>
codex --full-auto "$(cat phase-prompt.txt)"
```

Use `<output_contract>` for structured phase deliverables:

```
<output_contract>
After completing this phase:
1. Write decisions to phase-N/findings.md
2. Append `### @codex → @<listen-name> — [ISO-timestamp] Phase N done: <summary>` or `### @codex → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>` to collab.md
3. Leave STATUS.md to the lead; your step-2 line carries the PR link
4. Commit with: feat(phase-N): <description>
</output_contract>
```

## Worktree Setup

In T3 use `delegate_task` with `isolation:"worktree"` for this thread's own project;
local cross-project delegation is refused. For another project, use an existing
lead in that project, or the canonical top-level launch path only when the user
asked for a new thread. Do not create a shell worktree.
Follow the [canonical worktree launch guard](../../agent-routing/references/worktree-launch.md)
for the explicit parent-OID preflight and one-read rule for top-level worktree launches.
Outside T3, preflight the actual project root first and pass its verified commit
OID to the authorized manual worktree creation. Install dependencies from the
lockfile inside that worktree; never symlink `node_modules` across checkouts.

For cleanup after merge or pushed-branch handoff, follow the
[/pr-loop Cleanup Receipt SSOT](../../pr-loop/references/merge-and-verification.md#cleanup-receipt),
including its preservation checks, retirement block, and removal proof.
Name and escalate kept paths to the lead; end the DONE report with that CLEANUP RECEIPT.

## Waiting on Workers (no collab monitor)

"Codex seats must not poll collabs; T3 delegate completions already wake you." (Etan 2026-10-18, via orc collab)

- **T3 (default in T3):** dispatch with `delegate_task` and end the turn. The completion notification wakes you (SKILL.md § T3-native execution). Arm nothing.
- **cmux adapter:** run no collab monitor. Your guard is the worker's process exit: `skills/golem-powers/codex-workflows/scripts/codex-workflows.sh watch --run-id <run-id>`. When it wakes you, read the finished worker log and `collab.md` once; never poll `read_screen` in a loop.
- **Something must sit and watch** (CI, a file): one bounded `codex.subagent.mechanical` child (model: `node scripts/model-roles.mjs codex.subagent.mechanical --use watcher`) with a deadline and a single terminal report, settled at its terminal state. Never this seat, never a re-arm loop.

## Limitations

- No subagent spawning outside T3 — each Codex instance is standalone; spawn from orchestrator terminal (in T3, use `delegate_task`)
- No session resume — pass plan README as context in next invocation
- No MCP access — write decisions to `<phase>/findings.md`, not BrainLayer
- No CronCreate and no collab monitor — completion notifications (T3) or one process-exit watch (cmux adapter)
- No plan mode — write plan structure to markdown first
