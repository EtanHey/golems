# Kiro CLI — cmux-agents Adapter

> CLI-specific syntax and capabilities for Kiro agents in cmux panes.
> Binary at `~/.local/bin/kiro-cli`.

## CLI Syntax

| Mode | Command | Notes |
|------|---------|-------|
| **Non-interactive** | `kiro-cli chat --no-interactive "PROMPT"` | No user prompts, runs to completion |
| **Interactive** | `kiro-cli chat "PROMPT"` | Prompts for approval on tool use |
| **Trust all tools** | `kiro-cli chat -a "PROMPT"` | Full auto, no approval prompts |
| **Resume** | `kiro-cli chat --resume` | Resume most recent conversation |

## Model Selection

Default model is `auto` (Kiro routes automatically). Override with `--model MODEL`.

## Worktree Capabilities

**Kiro has NO native worktree support.** Manual setup required (same as Codex — see codex.md).

## Preferred cmux lifecycle

Use `spawn_agent({cli:"kiro"})` for visible Kiro workers and keep the handle as an `agent_id`:

```text
agent_id = spawn_agent({ repo: "golems", cli: "kiro", model: "kiro", prompt: "Draft a concise troubleshooting note" })
wait_for({ agent_id, target_state: "done", timeout_ms: 1800000 })
```

If you need a follow-up, use `send_to({agent_id,...})`. Fall back to raw surface typing only when parser ambiguity blocks the agent channel.

## Prompting Style

- Natural language, plain text
- No special tags or format contracts
- Max skill tokens: ~3000

## Error Patterns

| Screen Output | Problem | Fix |
|---------------|---------|-----|
| `unexpected argument '-p'` | Wrong flag | Use positional arg: `kiro-cli chat "PROMPT"` not `-p` |
| `command not found: kiro-cli` | Not installed | Check `~/.local/bin/kiro-cli` |

## Wrong Syntax (common mistakes)

- ~~`kiro-cli chat -p "prompt"`~~ — `-p` doesn't exist. Use positional argument.
- ~~`kiro-cli "prompt"`~~ — Missing `chat` subcommand.

## Unique Capabilities (not available in other CLIs)

- Free tier (KIRO FREE plan)
- Code intelligence features
- Agent profiles (`--agent`)

## Limitations (vs other CLIs)

- No native worktree isolation
- No MCP server access
- No hook system
- No subagent spawning
- Limited model selection
- Text-only output

---

## CLI Commands Reference (for cmux remote control)

### Commands

| Command | What It Does | Via cmux |
|---------|-------------|----------|
| `/resume` | Resume most recent conversation | `send_to({agent_id:"...", text:"/resume", press_enter:true})` |
| `/clear` | Clear conversation | `send_to({agent_id:"...", text:"/clear", press_enter:true})` |
| Ctrl+C | Exit session | `close_surface({scope:"agent", agent_id:"...", force:true})` or send an interrupt only if the agent channel is unavailable |

**No `/mcp`** — Kiro has no MCP support.
**No `/compact`** — no manual context compaction.
**No `/model`** — model set at launch via `--model` flag.

### Detecting Agent State via read_screen

| Screen Pattern | State | Safe to Send? |
|----------------|-------|--------------|
| `>` or `kiro>` prompt | Idle | YES |
| Text streaming | Working | NO — wait |
| `Allow?` or `(y/n)` | Waiting for approval | Send `y` + return |
| `$` shell prompt | Session ended | Kiro exited |

### Common Remote Operations

**Send a follow-up:**
`send_to({agent_id:"...", text:"Your instruction", press_enter:true})`

**Kiro is the simplest CLI** — no MCP, no menus, no interactive navigation. Just prompt → response → done.
