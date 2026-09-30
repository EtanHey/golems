# Claude Code — cmux-agents Adapter

> CLI-specific syntax and capabilities for Claude Code agents in cmux panes.

## CLI Syntax

| Mode | Command | Notes |
|------|---------|-------|
| **Standard** | `claude --dangerously-skip-permissions` | Default — works everywhere |
| **With custom launcher** | User's configured launcher (e.g., `myLauncher -s`) | Check `~/.golems/config.yaml` for launchers |
| **Worktree isolation** | `claude --worktree <name>` | Native worktree — auto-creates git worktree, runs agent in it |
| **Resume session** | `claude --resume` | Resume last session (shows session picker) |

## Model Selection

For managed visible `spawn_agent` / repoGolem launches, use `claude.judgment` through the
bare launcher at 1M; verify its pin against the resolved role. Do not pass a managed model
parameter that overrides the launcher pin. `claude.subagent.cheap` is for bounded in-process
children or permitted headless one-shots, never full panes, synthesis, or PR-gating reviews.
Resolve from the golems checkout with `node scripts/model-roles.mjs <role> --field alias`.
Choose effort per `/large-plan` phase with a why and pass it explicitly at dispatch.

| Role | Selection | Use When |
|---|---|---|
| `claude.judgment` | Bare managed launcher; raw CLI resolves alias and passes phase effort | Decisions, orchestration, synthesis, review |
| `claude.subagent.cheap` | Agent tool's `model`: resolved alias | Single-fact recall, pane mechanics, verifiers |

```bash
# Raw CLI only; visible peers use repoGolem launchers:
: "${phase_effort:?Choose effort per /large-plan phase before dispatch}"
phase_flags=()
if [ "$phase_effort" != default ]; then phase_flags=(--effort "$phase_effort"); fi
claude --dangerously-skip-permissions --model "$(node scripts/model-roles.mjs claude.judgment --field alias)" "${phase_flags[@]}" 'task prompt'
```

For a cheap Agent child, resolve `claude.subagent.cheap --field alias` and pass that value
as `model`. Choose effort per `/large-plan` phase, record why, and pass it explicitly through
the supported dispatch path. Keep model resolver substitutions in generated commands.

## Worktree Capabilities

Claude Code has NATIVE worktree support:
```bash
# Auto-creates worktree, runs agent in isolation, cleans up
claude --worktree feat/my-branch

# For subagents (Agent tool in code):
Agent(isolation="worktree", prompt="task...")
```

**This is unique to Claude Code.** Other CLIs (Codex, Cursor, Gemini) require manual `git worktree add` before spawning.

## Preferred cmux lifecycle

When Claude runs as a **visible cmux peer**, the parent orchestrator should use the agent-based tools:

```text
spawn_agent({ repo: "orchestrator", cli: "claude", prompt: "Survey patterns" })  // no model — launcher pins claude.judgment; cheap work stays in-process
wait_for({ agent_id, target_state: "ready", timeout_ms: 120000 })
send_to({ agent_id, text: "Narrow scope to failure modes only", press_enter: true })
wait_for({ agent_id, target_state: "done", timeout_ms: 1800000 })
```

If `wait_for` times out but `read_screen` shows a usable prompt, that's FR-06 parser ambiguity. Trust the raw pane, file the cmuxlayer bug, and only then use a one-off surface-level fallback send if you must unblock delivery.

**Don't confuse Claude's two delegation modes:**
- `spawn_agent({cli:"claude"})` = visible peer in cmux with a durable `agent_id`
- `Agent(subagent_type=...)` = in-process Claude subagent with no cmux pane

## Custom Launchers

If `~/.golems/config.yaml` defines launchers (shell functions wrapping `claude`):
- `-s` on launchers = `--dangerously-skip-permissions` (not model selection)
- `-S` / `--sonnet` is a legacy model selector, refused for full panes; resolve roles for new commands
- `--resume` = resume last session

## Prompting Style

- Natural language. Long context at top, task at bottom.
- XML tags for structured sections: `<context>`, `<task>`, `<constraints>`
- Supports system prompt, thinking (adaptive), diff edit format
- Max skill tokens: ~4000

## Error Patterns

| Screen Output | Problem | Fix |
|---------------|---------|-----|
| `SessionStart hook error` | Hook script failed | Use `-s` flag or check hooks |
| Agent exits immediately | Wrong dir or crash | Check `cd` path, try `--resume` |
| BrainLayer timeout | Multiple agents hitting DB | Stagger launches by 10+ sec (SQLite = single writer) |

## Unique Capabilities (not available in other CLIs)

- `--worktree` — native git worktree isolation
- `--resume` — session continuity
- MCP server access (BrainLayer, VoiceLayer, etc.)
- Hook system (SessionStart, UserPromptSubmit)
- Subagent spawning via `Agent()` tool
- Background tasks via `TaskCreate`

---

## CLI Commands Reference (for cmux remote control)

### Slash Commands

| Command | What It Does | Via cmux |
|---------|-------------|----------|
| `/mcp` | MCP server manager (connect/disconnect) | Interactive menu — see procedure below |
| `/compact` | Compact context (reduce tokens) | `send_to({agent_id, text:"/compact"})` — runs immediately |
| `/clear` | Clear conversation, keep system prompt | `send_to({agent_id, text:"/clear"})` |
| `/model` | Change model (picker menu) | Interactive menu |
| `/effort` | Change effort level | `send_to({agent_id, text:"/effort high"})` |
| `/exit` | Exit session cleanly | `send_to({agent_id, text:"/exit"})` |
| `/help` | Show available commands | `send_to({agent_id, text:"/help"})` |
| `/config` | Open settings menu | Interactive menu |
| `/skill-name` | Invoke any skill | `send_to({agent_id, text:"/large-plan"})` |

### Interactive Menu Navigation (applies to /mcp, /model, /config)

- **Arrow keys DON'T WORK** via cmux — returns "unknown key"
- **Cursor starts at first item** — the target is often already selected
- **Read 40+ lines** with `scrollback: true` — default 20 cuts off long menus
- **Escape to close** — `send_to({mode:"key", surface, key:"escape"})`
- **Return to select** — `send_to({mode:"key", surface, key:"return"})`
- **Clear buffer first** — send bare `send_to({mode:"key", surface, key:"return"})` before `/mcp` to flush pending escape chars

### Detecting Agent State via read_screen

| Screen Pattern | State | Safe to Send? |
|----------------|-------|--------------|
| `❯` at line start | Idle (at prompt) | YES |
| `⏺` at line start | Working (generating) | NO — interrupts |
| `↑↓ to navigate` | In interactive menu | Navigate or escape first |
| `? (Y/n)` | Waiting for confirmation | `send_to({mode:"key", surface, key:"y"})` — agent-mode text is refused at permission prompts |
| `CLAUDE_COUNTER: N` | Just finished response | YES |

### /mcp Reconnect Procedure (tested 2026-04-03)

**Get `surface` first** — this whole procedure is surface-addressed, because once the
menu is open the agent-mode text path is refused by the picker safety gate. Read the
target's `surface_id` off its registry row:

```
mcp__cmuxlayer__list_agents({agent_ids: [agent_id]})   # → surface_id for the rows below
```

```
1. send_to({mode:"key", surface, key:"return"})        # Clear buffer
2. send_to({mode:"surface", surface, text:"/mcp"})     # Open menu
3. sleep 2
4. read_screen({ lines: 40, scrollback: true })        # See full menu
5. Cursor is on first item — if that's your target:
   send_to({mode:"key", surface, key:"return"})        # Select server
6. read_screen to confirm "Reconnect" option:
   send_to({mode:"key", surface, key:"return"})        # Confirm reconnect
7. send_to({mode:"key", surface, key:"escape"})        # Close menu
```

**Critical:** `/mcp` reconnect only reconnects the socket — does NOT reload MCP server code. See `orchestrator/standards/cross-agent-mcp-pattern.md` for the full MCP lifecycle.
