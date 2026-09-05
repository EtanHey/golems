# Codex CLI — large-plan Adapter

> Platform-specific syntax for executing large-plan phases with Codex.
> Codex v0.111.0+. Binary at `~/.bun/bin/codex`.

## Phase Execution

```bash
# Run a phase in full-auto mode from a worktree
cd ../wt-phase-<N>
codex --model gpt-5.4 --full-auto "$(cat phase-prompt.txt)"
```

Use `<output_contract>` for structured phase deliverables:

```
<output_contract>
After completing this phase:
1. Write decisions to phase-N/findings.md
2. Append `### @codex → @<listen-name> — [ISO-timestamp] Phase N done: <summary>` or `### @codex → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>` to collab.md
3. Update collab.md Task Board — status → done, add PR link
4. Commit with: feat(phase-N): <description>
</output_contract>
```

## Worktree Setup (Manual — No Native Support)

```bash
# Set up before spawning phase agents
git worktree add -b feature/phase-<N>-<name> ../wt-phase-<N> master
ln -s ../$(basename $PWD)/node_modules ../wt-phase-<N>/node_modules
cp .env ../wt-phase-<N>/.env

# Spawn
cd ../wt-phase-<N>
codex --model gpt-5.4 --full-auto "Execute phase N. Plan: $(cat ../plan/README.md)"

# Cleanup after merge
git worktree remove ../wt-phase-<N>
```

## Collab Monitoring (No CronCreate)

```bash
# Attach the packaged monitor in a supervised long-running command session
bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh start @<listen-name> <plan-dir>/collab.md && \
  bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh follow @<listen-name>

# From a separate control command when the plan is complete
bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh stop @<listen-name>
```

This addressed-message monitor does not observe a delegated CLI crash or stall. Also arm the worker's process-exit or scheduled process/registry liveness watcher; the collab monitor **MUST NOT be the only worker-liveness guard**. Read the finished worker screen or log once after the liveness watcher wakes you—never poll `read_screen` in a loop.

## Limitations

- No subagent spawning — each Codex instance is standalone; spawn from orchestrator terminal
- No session resume — pass plan README as context in next invocation
- No MCP access — write decisions to `<phase>/findings.md`, not BrainLayer
- No CronCreate — use the packaged collab-monitor `start`/`follow`/`stop` lifecycle
- No plan mode — write plan structure to markdown first
