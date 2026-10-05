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

Watches: follow `/collab-monitor` before dispatch and after every compaction;
a DONE marker or version match still needs artifact or real-client verification.
Use its native Monitor how-to, 30-minute expiry and re-arm rules; stop the returned
task ID with TaskStop when the plan closes. Codex seats use its packaged fallback.

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
| Orchestration, scaffolding | `claude.judgment` | Decisions and coordination |
| Implementation phase | See `/agent-routing` § Routing rules (SSOT) | Phase chooses effort and explains why |
| Bounded lookup or verifier | See routing pointer above | In-process parity work only; never judgment |
| PR-gating review, audit judgment | See routing pointer above | Decision-grade reasoning |

Resolve role model/alias with `node scripts/model-roles.mjs <role> --field model|alias`
(one field) from the golems checkout. Every phase records `role · effort · why`; choose
effort per `/large-plan` phase and pass it explicitly at dispatch. Managed Claude peers use the bare launcher pin, verified
against the role; Agent children receive the resolved alias. `codex.subagent.mechanical`
is a candidate: bench before use.

## Unique Capabilities (not available in other CLIs)

- `Agent(isolation="worktree")` — native phase isolation
- `Agent(run_in_background=true)` — async parallel phases
- `Monitor` — collab watches per `/collab-monitor`
- `EnterPlanMode` — structured spec before execution
- `claude --resume` — session continuity across days
- MCP access (BrainLayer for plan decisions, Supabase, etc.)
- Hook system (SessionStart loads plan context)
