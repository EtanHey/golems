# Claude Code — context-check Adapter

> Claude Code has full context-check support: audit + fix for skills, MCPs, hooks, and settings.

## Audit Commands

```bash
# Skills loaded
ls ~/.claude/skills/

# MCPs loaded — three sources (walk up directory tree)
cat .mcp.json 2>/dev/null
cat ../.mcp.json 2>/dev/null
python3 -c "import json; d=json.load(open('$HOME/.claude/settings.json')); print(json.dumps(d.get('mcpServers',{}), indent=2))" 2>/dev/null

# Hooks loaded
python3 -c "import json; d=json.load(open('$HOME/.claude/settings.json')); print(json.dumps(d.get('hooks',{}), indent=2))" 2>/dev/null

# Per-project override
cat .claude/settings.local.json 2>/dev/null || echo "NO OVERRIDE"

# Built-in MCP list (in session)
/mcp
```

## Fix Output: settings.local.json

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "disabledMcpjsonServers": ["brainlayer", "voicelayer", "supabase"],
  "hooks": {
    "SessionStart": [{ "hooks": [] }],
    "UserPromptSubmit": [{ "hooks": [] }]
  }
}
```

- `disabledMcpjsonServers` — from `mcps.block` in the project profile
- Hooks override — only set if `hooks: false` in profile
- Write to `.claude/settings.local.json` (project root)

## Fix Output: CLAUDE.md Section

```markdown
## CONTAINERIZATION

**You are [identity]. You work ONLY on this app.**

### Skill Allowlist — ONLY Use These
| Skill | Purpose |
|-------|---------|
| context7 | Docs lookup |
| commit | Git commits |

### Project Rules
- Never use coach/orchestrator/golem-specific skills
- No BrainLayer queries (not relevant to this project)
```

## Unique to Claude Code

| Feature | How |
|---------|-----|
| MCP disable | `disabledMcpjsonServers` in settings.local.json |
| Hook disable | Override hooks to `[]` in settings.local.json |
| Live MCP list | `/mcp` command in session |
| Per-project override | `.claude/settings.local.json` (project root) |
| Global config | `~/.claude/settings.json` |

## Verification

After generating settings.local.json, restart the session and re-run `/context-check` to confirm waste is reduced.
