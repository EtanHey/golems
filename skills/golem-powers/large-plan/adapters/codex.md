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

## Worktree Setup (Manual — No Native Support)

```bash
# Set up before spawning phase agents
git worktree add -b feature/phase-<N>-<name> ../wt-phase-<N> master
# Install dependencies in the worktree from the lockfile. Never symlink
# node_modules: in a workspace monorepo, cross-package imports would then run
# the main checkout's code instead of the branch's.
(cd ../wt-phase-<N> && bun install --frozen-lockfile)   # or npm ci / pnpm install --frozen-lockfile
cp .env ../wt-phase-<N>/.env

# Spawn
cd ../wt-phase-<N>
codex --full-auto "Execute phase N. Plan: $(cat ../plan/README.md)"

# Cleanup after merge, then end the DONE report with the CLEANUP RECEIPT
# (/pr-loop references/merge-and-verification.md § Cleanup Receipt)
git worktree remove ../wt-phase-<N>
```

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
