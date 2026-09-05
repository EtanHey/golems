# Claude Code — large-plan Adapter

> Platform-specific syntax for scaffolding and executing large plans in Claude Code.

## Spawning Parallel Phase Agents

For parallel rounds, spawn one Agent per phase in a single message:

```typescript
// Parallel phase agents — call multiple Agent() in one message
Agent(
  subagent_type: "general-purpose",
  isolation: "worktree",             // Auto-creates git worktree, auto-cleans
  run_in_background: true,           // Async — orchestrator monitors collab.md
  prompt: `Execute phase 2 of <plan-dir>. Coordination file: <plan-dir>/collab.md — read it now.`
)
Agent(
  subagent_type: "general-purpose",
  isolation: "worktree",
  run_in_background: true,
  prompt: `Execute phase 3 of <plan-dir>. Coordination file: <plan-dir>/collab.md — read it now.`
)
```

`isolation: "worktree"` is unique to Claude Code. Other CLIs require manual `git worktree add`.

## Collab Monitoring

```bash
# Preferred: /loop (foreground, stops when you stop it)
/loop 5m Read <plan-dir>/collab.md. Check status changes, blockers, completed phases. Advance round if all phases done.

# Alternative: CronCreate (background, survives session)
CronCreate(schedule="*/5 * * * *", command="bash $HOME/.golems/skills/golem-powers/collab-monitor/scripts/collab-monitor.sh run --once @<listen-name> <plan-dir>/collab.md")

# MANDATORY: CronDelete when plan is complete — crons persist until deleted
CronDelete(<cron-id>)
```

## Plan Mode

Before scaffolding a complex plan, structure the spec first:

```
EnterPlanMode → spec phases, dependencies, rounds, agents → ExitPlanMode → scaffold
```

## Session Resume

For multi-day plans, resume the orchestrator session:

```bash
claude --resume    # Shows session picker — return to mid-plan state
```

Or start fresh and load state: `Read <plan-dir>/README.md`

## Memory Persistence

Store plan decisions in BrainLayer for cross-session recall:

```
brain_store(content="[date] Phase 3: chose X over Y because...", tags=["large-plan", "<plan-name>", "decision"], importance=8)
brain_search(query="<plan-name> decisions")
```

## Model Selection

| Phase Type | Model | Why |
|------------|-------|-----|
| Orchestration, scaffolding | default (Opus) | Complex reasoning, MCP, subagents |
| Delegated phase work | `--model sonnet` | Fast, cost-effective |
| Code review, audit | `--model opus --effort medium` | Deep analysis |

## Unique Capabilities (not available in other CLIs)

- `Agent(isolation="worktree")` — native phase isolation
- `Agent(run_in_background=true)` — async parallel phases
- `CronCreate` / `/loop` — collab file monitoring
- `EnterPlanMode` — structured spec before execution
- `claude --resume` — session continuity across days
- MCP access (BrainLayer for plan decisions, Supabase, etc.)
- Hook system (SessionStart loads plan context)
