# Codex CLI — cmux-agents Adapter

> CLI-specific syntax and capabilities for Codex (OpenAI) agents in cmux panes.
> Codex v0.111.0+. Binary at `~/.bun/bin/codex`.

## CLI Syntax

| Mode | Command | Notes |
|------|---------|-------|
| **Full access (autonomous)** | `codex --dangerously-bypass-approvals-and-sandbox "PROMPT"` | Full autonomy — no approval prompts, no sandbox. Use repoGolem launchers for agent sessions; raw CLI is fallback/troubleshooting. |
| **Sandboxed auto** | `codex --full-auto "PROMPT"` | Auto-approves but keeps sandbox (workspace-write only). Safer but can't install deps or run arbitrary commands. |
| **Interactive** | `codex "PROMPT"` | Prompts for approval on each action |
| **Long prompt** | `codex --dangerously-bypass-approvals-and-sandbox "$(cat prompt.txt)"` | Shell substitution for long prompts |

## Model Source

For cmux **visible pane** agent sessions, the repoGolem launcher owns default pins and resume law: bare Codex pins the current top Sol, while explicit `-m`/`-E` selections are first-class. `spawn_agent` may omit `model` for Sol or pass an explicit supported Codex model. Merged cmuxlayer PR #396 validates that model against `codex debug models --bundled` before pane creation and forwards accepted model/effort values to the launcher; an unsupported model rolls back any newly prepared worktree. At read time `spawn_agent.effort` accepts `medium|high|xhigh|ultra`, while direct repoGolem `-E` also accepts `low` and `max`. Verify the effective model/effort from Codex session metadata, not from the agent's self-description. Internal ephemeral subagents (Task tool / in-session child) follow `/agent-routing` AP11.

## Composer-Wedge Submit Verification (2026-06-06)

On Codex panes, **`submit_verified` and `token_count` are untrusted** — scrollback is ground truth.

1. After every `send_to` — agent, surface, command, or key mode — `read_screen` within **15 seconds**.
2. **Submitted** = your prompt text appears in scrollback **above** the working/spinner line.
3. Text still after the `›` prompt marker = **unsubmitted** — resend via `send_to({mode:"command", surface, command})` (atomic) if idle, or investigate if working.
4. `'Queued follow-up inputs'` while status says working → full scrollback read (anomaly).
5. Doc doctrine did not stop post-#478 wedge catches (seven observer-window incidents; tallies vary). Mitigation here; cure = cmuxlayer composer-is-empty fix (D6).

## Worktree Capabilities

**Codex has NO native worktree support.** Manual setup required:

```bash
# Before spawning Codex agents on same repo:
cd $HOME/Gits/TARGET_REPO
git worktree add -b feat/agent-1 ../wt-agent-1 main

# Link node_modules (avoid re-install)
ln -s ../TARGET_REPO/node_modules ../wt-agent-1/node_modules

# Copy .env if needed
cp .env ../wt-agent-1/.env

# Then launch from the worktree dir
cd ../wt-agent-1 && codex --full-auto "task"
```

**Codex `apply_patch` path rule:** when the assigned worktree differs from the session cwd, every `apply_patch` filename must be an absolute path inside the worktree. `exec_command.workdir` does not apply to `apply_patch`; relative patch paths resolve against the session cwd and can mutate the main checkout silently.

## Preferred cmux lifecycle

Codex peers should be launched and monitored by `agent_id`, not by remembered surface numbers:

```text
spawn_agent({ repo: "golems", cli: "codex", prompt: "Fix search ranking" })
wait_for({ agent_id, target_state: "ready", timeout_ms: 120000 })
send_to({ agent_id, text: "Limit changes to search ranking only", press_enter: true })
wait_for({ agent_id, target_state: "done", timeout_ms: 1800000 })
```

Codex has **no `Agent()` tool**. For visible parallel work, `spawn_agent({cli:"codex"})` is the primary path. Reach for `list_agents({agent_ids:[agent_id], detail:"full"})` when you want a cheap state snapshot; fall back to `read_screen` only for parser disputes.

## Prompting Style

- Use `<output_contract>` tags for structured output — GPT follows format contracts reliably
- Explicit section headers, numbered lists
- Supports system prompt, reasoning effort config
- Max skill tokens: ~4000

## Collab Name-Claims in the Dispatch BRIEF (standing rule; canonical text: weave SKILL.md §5b)

**Key insight (shipped eval, 2026-06-11):** Codex workers never load Claude skills — the BRIEF is their only protocol carrier. In-context examples alone teach the post format but NOT the rules (worker-name inheritance, monitor semantics), so the brief must carry the rules explicitly.

Every Codex worker BRIEF must include:

1. **The worker's assigned claimed name** — `<lead>-w<N>`, assigned by the lead, who POSTS the claim on the worker's behalf BEFORE first dispatch.
2. **The 4-line protocol summary**, verbatim in the brief:
   - Claim-on-entry: every seat's first channel post begins `> CLAIM name=<name> role=<lead|worker|weaver|orc> monitor=<task-id|none>` — YOUR claim was already posted by your lead on your behalf; do NOT post a duplicate claim line.
   - Names are immutable for the channel's life; workers inherit `<lead-claim>-w<N>` assigned at spawn — never ad-hoc per-post identities.
   - @-mentions and channel monitors anchor on claimed names ONLY.
   - `monitor=none` is an explicit contract: "no delivery guarantee — nudge me."
3. **The header instruction** — all of the worker's channel posts use `### <claimed-name> (<ts>)` headers, byte-identical to the claim.

## Error Patterns

| Screen Output | Problem | Fix |
|---------------|---------|-----|
| `command not found: codex` | Not installed | `bun install -g @openai/codex` |
| Shell hangs after `cd && codex` | Chained commands race condition | `cd` first, verify `$` prompt, then `codex` separately |
| `spawn codex ENOENT` | T3 can't find binary | Restart T3 with codex in PATH |

## Wrong Syntax (common mistakes)

- ~~`codex exec -m MODEL -s danger-full-access`~~ — old syntax (pre-v0.111.0)
- ~~`cd repo && codex ...`~~ — chained commands fail in fresh terminals

## Unique Capabilities (not available in other CLIs)

- Strong structured output (output contracts)
- Non-interactive mode (full-auto, no prompts)
- Fast execution (terminal-native, no browser overhead)

## Skills System

Codex discovers skills from 3 locations:
1. `.agents/skills/` — project-level (checked into git)
2. `~/.codex/skills/` or `~/.agents/skills/` — personal
3. `/etc/codex/skills/` — system-wide

**Invoke with `$skill-name`** (dollar prefix, not slash):
- `$commit` invokes the commit skill
- `$fix`, `$test`, `$review` etc.
- `/skills` lists all available skills

Most Claude Code skills work in Codex without modification — same `SKILL.md` format.

## Session Resume

- Prefer repoGolem `-c` from the session cwd or `resume <UUID>` for launcher-managed panes. The launcher restores the selected rollout's model+effort, explicit `-m`/`-E` wins, and un-honorable resumes fail instead of silently fresh-booting.
- Bare repoGolem `resume` picker mode is refused because the launcher cannot recover model/effort before selection; resume combined with `-p/--print` is also refused.
- Raw fallback: `codex resume <path>` or `/resume` inside an active session.
- Sessions stored in `~/.codex/sessions/`

## Subagents

- `/agent` command to switch between, monitor, or stop active sub-threads
- Main agent orchestrates isolated LLM sessions
- `spawn_agents_on_csv` for batch parallel tasks (e.g., security audits across many items)

## Hooks

- Defined in `SKILL.md` or `config.toml`
- Pre-tool and post-prompt event hooks
- Used for automated safety checks, logging, context injection

## MCP Support

MCP supported (v0.98.0+) via `codex mcp add <name> -- <command>`. Config: `~/.codex/config.toml` (global) or `.codex/config.toml` (per-project). BrainLayer + Exa already wired globally.

## Limitations (vs other CLIs)

- No native worktree isolation (manual git worktree required)
- In Codex, `apply_patch` paths are resolved from the session cwd, not from any shell `workdir`; use absolute worktree paths.

---

## CLI Commands Reference (for cmux remote control)

### Slash Commands

| Command | What It Does | Via cmux |
|---------|-------------|----------|
| `/clear` | Reset UI and conversation | `send_to({agent_id, text:"/clear"})` |
| `/compact` | Summarize conversation to free tokens | `send_to({agent_id, text:"/compact"})` |
| `/new` | Start fresh conversation in same session | `send_to({agent_id, text:"/new"})` |
| `/resume` | Resume a saved conversation | `send_to({agent_id, text:"/resume"})` |
| `/fork` | Clone current conversation to new thread | `send_to({agent_id, text:"/fork"})` |
| `/model` | Choose model + reasoning effort level | Interactive menu |
| `/fast` | Toggle fast mode | `send_to({agent_id, text:"/fast"})` |
| `/diff` | Display git diff including untracked files | `send_to({agent_id, text:"/diff"})` |
| `/status` | Show session config and token usage | `send_to({agent_id, text:"/status"})` |
| `/plan` | Switch to plan mode (read-only) | `send_to({agent_id, text:"/plan"})` |
| `/review` | Code review of working tree changes | `send_to({agent_id, text:"/review"})` |
| `/mcp` | List configured MCP tools | `send_to({agent_id, text:"/mcp"})` |
| `/agent` | Switch active agent thread | `send_to({agent_id, text:"/agent"})` |
| `/ps` | Show background terminals and output | `send_to({agent_id, text:"/ps"})` |
| `/init` | Generate AGENTS.md scaffold | `send_to({agent_id, text:"/init"})` |
| `/skills` | List installed skills | `send_to({agent_id, text:"/skills"})` |
| `$skillname` | Invoke a skill (dollar prefix) | `send_to({agent_id, text:"$commit"})` |
| `@path` | Fuzzy file mention | `send_to({agent_id, text:"@src/main.ts"})` |
| `!command` | Execute shell command directly | `send_to({agent_id, text:"!ls -la"})` |
| `/exit` | Exit cleanly | `send_to({agent_id, text:"/exit"})` |

### Keyboard Shortcuts (in interactive mode)

| Shortcut | Action | Via cmux |
|----------|--------|----------|
| `Ctrl+C` | Cancel current op (2x to quit) | Send interrupt |
| `Ctrl+D` | Exit (2x to force quit) | — |
| `Ctrl+L` | Clear terminal screen | — |
| `Tab` | Queue follow-up prompt while working | `send_to({mode:"key", surface, key:"tab"})` |
| `Esc + Esc` | Edit previous message | — |
| `@` | Fuzzy file search | `send_to({agent_id, text:"@", press_enter:false})` |

### Prompting Best Practices

- **`AGENTS.md`** is Codex's `CLAUDE.md` — project instructions loaded at session start
- Use `/init` to auto-generate one
- `@path/to/file` to mention files (like CC's Read tool but inline)
- `!command` for inline shell execution
- Use `--search` flag for web-enabled sessions
- Codex profiles (`-p fast`, `-p thorough`) for different workflows; do not confuse this with repoGolem `-p` print mode, which is not for agent sessions

### Detecting Agent State via read_screen

| Screen Pattern | State | Safe to Send? |
|----------------|-------|--------------|
| `$` or `❯` at line start | Idle (at prompt) | YES |
| Text streaming with `⠋⠙⠹` spinner | Working | NO — wait |
| `(y/n)` prompt | Waiting for approval | Send `y` + return |
| `codex>` prompt | Interactive mode | YES |

### Common Remote Operations

**Send a follow-up message:**
`send_to({agent_id:"...", text:"Your instruction here", press_enter:true})`

**Exit cleanly:**
`close_surface({scope:"agent", agent_id:"...", force:true})`

**No MCP reconnect** — restart session instead. Codex MCP config is read at startup only.
