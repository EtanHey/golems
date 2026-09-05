---
name: cli-agents
description: "Run external CLI agents (Gemini, Cursor, Codex, Kiro, Claude) as visible cmux workers through repoGolem launchers. Use for delegating implementation, spawning research/audit agents, or coordinating multi-agent builds. Workers split in the current workspace; audits/research use a separate named workspace. NOT for plain cmux pane management or Claude-only spawning."
---

# CLI Agents Skill

External AI agents spawned as interactive cmux panes via repoGolem launchers. Two patterns based on intent:

| Intent | Where | Why |
|--------|-------|-----|
| **Worker** (code, implementation, collab) | Split in current workspace | Visible side-by-side, easy to monitor |
| **Audit/Research** (read-only, analysis) | New workspace, named | Doesn't clutter working view, find in sidebar |

## 🔥 THE ONE TRUE FORM: `{repo}{Tool} -s "prompt"`

**Every dispatch in this skill uses repoGolem launchers.** The launcher handles cd + env vars (`MCP_CONNECTION_NONBLOCKING=1`, `CLAUDE_CODE_NO_FLICKER=1`) + iTerm profile + MCP wiring + 1Password secrets + tab title.

```bash
brainlayerCursor -s "audit X"      # gather (read-only)
brainlayerCodex  -s "fix Y"         # implement
brainlayerClaude -s "coordinate Z"  # orchestrate
brainlayerGemini -s "visual task"   # visual / OCR
```

**NEVER write:**
- `cd ~/Gits/X && cursor agent "..."` — launcher already cds
- `MCP_CONNECTION_NONBLOCKING=1 CLAUDE_CODE_NO_FLICKER=1 codex "..."` — launcher already exports both
- `source ~/.zshrc && claude -s "..."` — launchers are functions, already in the calling shell
- `brainlayerCodex --fast "..."` — `--fast` is not a repoGolem routing flag. Use `-s`.
- Raw `cursor agent` / `codex` / `claude` — skips iTerm profile, MCP wiring, 1Password, agent-context injection

See `/agent-routing` AP11 (2026-05-21 severity-10 user mandate) for the full incident history.

## Spawning Workers (split in current workspace)

```bash
# Split right, label it, send the launcher command
SURFACE=$(cmux new-split right | awk '{print $2}')
cmux rename-tab --surface "$SURFACE" "Agent Label"
cmux send --surface "$SURFACE" "{repo}{Tool} -s 'your prompt here'"
cmux send-key --surface "$SURFACE" Return
```

### Examples by CLI

```bash
# Claude worker in brainlayer
cmux send --surface "$SURFACE" "brainlayerClaude -s 'your prompt here'"

# Cursor is read-only/gather-only; spawn it from the Audits/Research section below

# Codex worker in voicelayer
cmux send --surface "$SURFACE" "voicelayerCodex -s 'your prompt here'"

# Gemini worker (visual / OCR) in golems
cmux send --surface "$SURFACE" "golemsGemini -s 'your prompt here'"

# Kiro worker in orchestrator
cmux send --surface "$SURFACE" "orcKiro -s 'your prompt here'"
```

If a launcher doesn't exist for the project, add it to `~/.config/ralphtools/registry.json` and run `_ralph_generate_launchers_from_registry`. See `/repogolem` for the registry workflow.

### Example: 3 parallel Claude workers

```bash
# Launch sequentially (1Password biometric needs ~2s between each)
for repo in brainlayer golems voicelayer; do
  SURFACE=$(cmux new-split right | awk '{print $2}')
  cmux rename-tab --surface "$SURFACE" "$repo"
  cmux send --surface "$SURFACE" "${repo}Claude -s 'your task here'"
  cmux send-key --surface "$SURFACE" Return
  sleep 3  # Wait for Touch ID
done
```

## Spawning Audits/Research (new workspace)

```bash
# New workspace so it doesn't clutter your working view
cmux new-workspace
SURFACE=$(cmux list-pane-surfaces --pane "$(cmux list-panes | tail -1 | grep -oE 'pane:[0-9]+')" | grep -oE 'surface:[0-9]+' | head -1)
cmux rename-tab --surface "$SURFACE" "Audit: reponame"
cmux send --surface "$SURFACE" "{repo}{Tool} -s 'your audit prompt'"
cmux send-key --surface "$SURFACE" Return
```

### Example: Cursor audit in separate workspace

```bash
cmux new-workspace
SURFACE=$(cmux list-pane-surfaces --pane "$(cmux list-panes | tail -1 | grep -oE 'pane:[0-9]+')" | grep -oE 'surface:[0-9]+' | head -1)
cmux rename-tab --surface "$SURFACE" "Audit: golems"
cmux send --surface "$SURFACE" "golemsCursor -s 'Audit recent changes. Check: code quality, bugs, missing tests, security, dead code. Be harsh.'"
cmux send-key --surface "$SURFACE" Return
```

### Example: Multi-agent audit wave (3 perspectives)

```bash
for i in 1 2 3; do
  cmux new-workspace
  SURFACE=$(cmux list-pane-surfaces --pane "$(cmux list-panes | tail -1 | grep -oE 'pane:[0-9]+')" | grep -oE 'surface:[0-9]+' | head -1)
  cmux rename-tab --surface "$SURFACE" "Audit $i: golems"
  cmux send --surface "$SURFACE" "golemsCursor -s 'ANGLE $i PROMPT'"
  cmux send-key --surface "$SURFACE" Return
  sleep 3
done
```

## Monitoring Agents

```bash
# Check what an agent is doing
cmux read-screen --surface surface:N --lines 8

# Check all agents at once (via cmux)
cmux list-surfaces --include-screen-preview

# Send follow-up to an agent
cmux send --surface surface:N "additional instructions"
cmux send-key --surface surface:N Return
```

## Agent Selection Guide

| Task | Launcher form | Notes |
|------|---------------|-------|
| Plan auditing, perspectives | `{repo}Cursor -s` | Read-only, Auto model (no `--model` flag) per AP3 |
| Code review, codebase analysis | `{repo}Cursor -s` | Has `@codebase` access |
| Quick research, comparisons | `{repo}Gemini -s` | Free tier; visual/OCR strength per agent-routing |
| Parallel implementation | `{repo}Codex -s` | Default GPT-5.5; override only when needed |
| Collab agent (writes to collab file) | `{repo}Claude -s` | Use Sonnet for audit collabs via `-S` |
| Deep reasoning, architecture | `{repo}Claude -s` | Opus default; only when needed |

## Cursor Bug Bot (GitHub PR Reviews)

```bash
# Trigger inline PR review on GitHub
gh pr comment <N> --body "@cursor @bugbot review"
```

(Note: `@cursor @bugbot review` is the correct trigger phrase. NOT `@CursorBot` or `@cursor-bugbot` — those silently fail.)

## Rules

1. **Workers = split, Audits = new workspace** — don't mix
2. **Use `{repo}{Tool} -s` form ALWAYS** — never raw `cursor`/`codex`/`claude`, never `cd ~/Gits/…`, never `MCP_CONNECTION_NONBLOCKING=1`, never `--fast`. See `/agent-routing` AP11.
3. **Launch sequentially** — 1Password biometric needs ~2-3s between spawns
4. **Use Sonnet for audits** — pass `-S` to Claude launchers; don't waste Opus on read-only analysis
5. **Name workspaces clearly** — "Audit: reponame", "Research: topic"
6. **Monitor with read-screen** — don't assume agents finished
7. **Verify cursor findings** — cursor can't always tell if files are git-tracked. Check with `git ls-files` before acting.
