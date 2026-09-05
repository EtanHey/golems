---
name: cmux
description: "Control cmux panes, splits, browser/sidebar, messages. Triggers: cmux, split panes, terminal reads. NOT shell."
---

# cmux Terminal Control

> Teach agents to drive cmux: split panes, notify, open browser, coordinate with other agents.

## `cmux` vs `cmuxlayer` (read this first)

Two different things share the `cmux` root — do not conflate them:

- **`cmux`** = the **terminal app / CLI / terminal surfaces** (panes, splits, tabs, browser, `read_screen`, raw `cmux ...` shell commands). This skill is about `cmux`.
- **`cmuxlayer`** = the **MCP / managed-agent / orchestration layer** that runs agents on top of cmux panes (the worker lifecycle: spawn, wait, route, stop). That layer is taught by `/cmux-agents`.

Compatibility note: the MCP tool namespace is still `mcp__cmuxlayer__*` (e.g. `mcp__cmuxlayer__spawn_agent`) and the `.mcp.json` server key is still `cmux`, even though the package/binary is `cmuxlayer` / `cmuxlayer-mcp`. **Keep using the literal `mcp__cmuxlayer__*` tool names** — they are the current registered handles. Only the human-readable name of the *layer* is `cmuxlayer`; never call the layer `cmux MCP`, `cmux.layer`, or `cmux layer`. <!-- naming-lint:allow -->

**For agent workflows, prefer `/cmux-agents` and the agent-based MCP tools** (`spawn_agent`, `send_to`, `wait_for`, `list_agents`, `close_surface`). This skill stays primitive-first on purpose: panes, tabs, browser surfaces, raw terminal delivery, and low-level inspection.

## Detect cmux

Always check first — skip gracefully if not in cmux:

```bash
if ! command -v cmux &>/dev/null || ! cmux identify --json &>/dev/null; then
  echo "Not in cmux — skipping cmux operations"
  exit 0
fi
```

## Self-Identification

```bash
# Get your own location
cmux identify --json
# → { "surface_ref": "surface:4", "pane_ref": "pane:5", "workspace_ref": "workspace:2" }
```

## Identify & Navigate

```bash
# Get your current surface/pane/workspace refs
cmux identify

# List all workspaces
cmux list-workspaces

# List panes in current workspace
cmux list-panes

# List surfaces (tabs) in a pane
cmux list-pane-surfaces --pane pane:1
```

## Splits (Most Common)

```bash
# Split current surface left/right/up/down
cmux new-split right    # adds a right split in current workspace
cmux new-split down

# Get the new surface ref after splitting
cmux list-pane-surfaces --pane pane:1

# Close a surface
cmux close-surface --surface surface:5
```

## Workspaces (New Tabs)

```bash
# New workspace (new sidebar tab)
cmux new-workspace

# Focus a workspace
cmux focus-pane --pane pane:2

# Rename the tab label
cmux rename-tab --surface surface:3 "🤖 Agent Name"
```

## Send Commands to Panes

```bash
# Send text (as if typed) to a surface
cmux send --surface surface:3 "cd $HOME/Gits/golems && claude 'prompt here'\n"

# Send a single key
cmux send-key --surface surface:3 Return

# Note: \n at end of send = auto-press Enter to run
```

**🚨 Never type a bare `@word` into another agent's composer.** `cmux send` and `send_to` in `surface`/`command` mode deliver live keystrokes — a leading `@` (e.g. `@narration-lead`) fires the receiving TUI's file-reference picker and mangles the message (`ok:true` won't report it). Use the bare name (`narration-lead:`) for pane sends; reserve `@<name>` for collab `.md` posts where monitors match it. Real bug, 2026-06-14. Full detail: `/cmux-agents` → "THE `@`-MENTION FILE-PICKER TRAP".

**Compound commands can split across PTY buffer writes.** Separate source and launch:
```bash
# SAFE: separate commands
cmux send --surface surface:N "source ~/.zshrc\n"
sleep 3
cmux send --surface surface:N "cd $HOME/Gits/repo && claude -s\n"

# UNSAFE: long compound — may corrupt shell parsing
# cmux send --surface surface:N "source ~/.zshrc && cd $HOME/Gits/repo && claude -s\n"
```

## Notifications

```bash
# Notification ring (tab lights up in sidebar)
cmux notify "Title" "Body text"

# Workspace-action for custom sidebar label
cmux workspace-action --action set-title --title "🤖 orcClaude"
```

## In-App Browser

```bash
# Open browser pane (splits alongside terminal)
cmux new-pane --type browser --direction right --url "http://localhost:3000"

# Navigate existing browser surface
cmux browser navigate "http://localhost:3000/new-page"

# Browser tab management
cmux browser tab new "https://docs.example.com"
cmux browser tab list
```

## Agent-to-Agent Messaging

```bash
# Send text to another agent's surface
cmux send --surface surface:6 "STATUS: done with auth module, ready for review"

# Envelope format for deterministic messaging:
# [FROM=surface:A TO=surface:B TYPE=TYPE] key=val
cmux send --surface surface:6 \
  "[FROM=surface:1 TO=surface:6 TYPE=TASK] repo=golems task=fix-tests"
```

## Parallel Agent Fan-out Pattern

```bash
# 1. Identify self
MY_SURFACE=$(cmux identify | jq -r '.caller.surface_ref')
MY_WS=$(cmux identify | jq -r '.caller.workspace_ref')

# 2. Spawn 3 splits, each running claude on different repos
for repo in brainlayer golems voicelayer; do
  NEW_SURFACE=$(cmux new-split right --workspace "$MY_WS" | awk '{print $2}')
  cmux rename-tab --surface "$NEW_SURFACE" "🤖 $repo"
  sleep 0.5
  cmux send --surface "$NEW_SURFACE" "cd $HOME/Gits/$repo && claude 'your task here'\n"
done
```

## golem-terminal Integration Note

> **Future reference only — golem-terminal is not yet built.**

These cmux patterns are the reference implementation for golem-terminal's UDS API. The golem-terminal equivalents:

| cmux | golem-terminal |
|------|---------------|
| `cmux split` | `orchestrate.py split <slot>` |
| `cmux notify` | HTTP POST localhost:3847/notify |
| `cmux sidebar set` | UDS `status` command |
| `cmux send` | UDS `send_input` command |
| `cmux open-browser` | Built into sidebar pane |

## Post-Restart Truth-vs-Display (2026-06-06)

After **ANY** cmux restart, every lead **VERIFIES** before reporting worker liveness:

```text
checkpoint → restart → VERIFY (list_agents + read_screen) → report from evidence
```

- Pair `list_agents` with `read_screen` scrollback on each worker you claim is alive.
- **Never carry pre-restart claims forward** — registry and your memory are stale until re-verified.
- Status to collab/Etan cites scrollback evidence, not remembered state.

Full protocol: `/cmux-agents` Post-Restart Truth-vs-Display.

## Composer-Wedge Runtime Doctrine (2026-06-06)

Delivery fields lie. **`boot_prompt_delivered`, `submit_verified`, parsed working-status, and `token_count` are untrusted** — seven post-#478 catches proved doc-only mitigation is insufficient (observer tallies vary 3/4/5/7; no canonical ledger; cure = cmuxlayer code fix D6).

**Ground truth:** prompt text in SCROLLBACK above the working line. Text after the `›` marker = **unsubmitted**.

**Rules:**
- `read_screen` ≤15s after **every** dispatch.
- `'Queued follow-up inputs'` on a `working` worker → full scrollback read (anomaly).
- Idle Codex: `send_to({mode:"command"})` (atomic) or `send_to({mode:"surface"})` + verified status flip.

Full doctrine: `/cmux-agents` Composer-Wedge Runtime Doctrine.

## Verify Delivery (CRITICAL — from session mining)

**`send_to` returns `ok:true` even on frozen terminals.** Never trust `submit_verified` or `boot_prompt_delivered` either — see Composer-Wedge doctrine above.

### Boot verification (before sending task prompt)
```bash
# Claude takes 8-15s to boot + MCP init
sleep 15
cmux read-screen --surface surface:N --lines 5
# "❯" with "0 tokens" → Claude ready, send prompt
# "zsh%" or bare shell prompt → Claude didn't start, retry launch
# Blank screen → wait longer, re-read in 5s
```

### Post-send verification (after sending task prompt)
```bash
sleep 8
cmux read-screen --surface surface:N --lines 5
# Check: did token count jump? Is there new output?
# If token count SAME after 2 checks → terminal frozen → kill → spawn_agent → resend
```

**Stuck-state detection cheat sheet:**
- `"Press up to edit queued messages"` → **STUCK** — send Enter key to unblock
- `"Twisting/Channelling + timer"` → THINKING (verify with token count delta)
- Token count same between two reads → STUCK or DONE (investigate)
- `"❯"` prompt with 0 tokens → boot not complete, wait longer
- `"zsh%"` or bare shell prompt → agent didn't boot, retry launch command
- `"tools not available"` or `"MCP connection failed"` → MCP server down, don't proceed
- High token count but no tool calls in last 50 lines → agent may be rambling, not executing

## Screenshots vs read_screen

`read_screen` is terminal text inspection, not a screenshot. When Etan asks to see something or asks for a screenshot, use Computer Use screenshot and deliver the image. After interactive probes, screenshot proactively when the result is visual or user-facing.

Before pressing Enter in any TUI menu, verify the highlighted row first. Use Computer Use screenshot when the user needs to see the state; use `read_screen` only when the selected row is explicit in terminal text.

## read_screen Depth

**Default for agent monitoring: `lines: 50, scrollback: true`** — NOT 15.

Bottom 15 lines = status bars and thinking indicators. Actual work (file edits, tool calls, decisions) is ABOVE the fold. Use 50+ lines to see what's really happening.

**Exception:** Post-send verification (checking token count jumped) → 5 lines is fine.

## Rules

0. **Monitor/cron/loop-payload rules** → see **cron-payload-discipline** (canonical). cmux stays pane-primitive only.
1. **Always detect cmux first** — don't assume you're in cmux
2. **Use envelope format** for agent messages — prevents cross-pane confusion
3. **Set sidebar status** at task start + end — gives user visibility
4. **Notify on completion** — ring is better than polling
5. **Don't spawn too many panes** — 4-6 max, cmux gets crowded
6. **Verify delivery after every send** — ok:true is optimistic, not verified
7. **read_screen 50+ lines for monitoring** — 15 lines sees only status bars
8. **Respawn > absorb** — frozen agent → read_screen 50 lines (salvage what it did) → brain_store accomplishments → kill → spawn_agent → resend SAME task with "already done: X" context. NEVER pull agent work into your own context.
9. **Don't press Enter in interactive menus blindly** — verify the highlighted row first, preferably with a screenshot when the user asked to see it. If selection state is unclear, send the INSTRUCTION to the agent instead: `"Run /mcp, reconnect brainlayer, verify with brain_search('test')."`
10. **Report evidence, not vibes** — cite WHAT the agent produced (file edits, tool calls, test counts), not just THAT it appears active. "Token count +5K, edited 3 files" > "Making progress."

## See Also

- `/cmux-agents` — visible worker spawning, `spawn_agent` / `send_to` / `wait_for` lifecycle, and recovery protocols
- `/orc` — orchestration decisions, design iteration gates, collab protocols
