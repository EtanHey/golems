---
name: context-check
description: "Audit/fix AI context hygiene vs ~/.golems/config.yaml. Triggers: context check/bloat, MCP/skill/hook hygiene."
user-invocable: true
---

# context-check

Audit what's loaded vs what SHOULD be loaded for this project.

## Usage

```bash
/context-check          # Audit mode — report waste
/context-check --fix    # Fix mode — generate configs
```

## How It Works

1. **Read the registry** — `~/.golems/config.yaml` → `contextProfiles` section
2. **Detect current project** — match cwd against registry paths
3. **Compare** loaded skills/MCPs/hooks/agents against the profile
4. **Report** waste (token count, attention dilution estimate)
5. **Fix** (if --fix) — generate `.claude/settings.local.json` + CLAUDE.md section

## Step-by-Step

### Step 1: Read Registry

```bash
cat ~/.golems/config.yaml
```

Find the `contextProfiles` section. Look up the current project by matching `pwd` against registered project paths (either from `contextProfiles` keys or from `~/.config/ralphtools/registry.json` → `projects` → `path`).

**If project NOT found:** Say so. Offer to run repo discovery (scan package.json, detect stack, suggest a profile). Do NOT guess.

### Step 2: Get Current Loaded Context

**Skills loaded:** List all files in `~/.claude/skills/` — each directory is a loaded skill.
```bash
ls ~/.claude/skills/
```

**MCPs loaded:** Check which MCP servers are configured:
```bash
# Project MCPs
cat .mcp.json 2>/dev/null
# Parent dir MCPs (Claude Code walks up)
cat ../../../.mcp.json 2>/dev/null  # adjust depth for $HOME/Gits/.mcp.json
# Global MCPs
python3 -c "import json; d=json.load(open('$HOME/.claude/settings.json')); print(json.dumps(d.get('mcpServers',{}), indent=2))" 2>/dev/null
```

**Hooks loaded:** Check global settings for hooks:
```bash
python3 -c "import json; d=json.load(open('$HOME/.claude/settings.json')); print(json.dumps(d.get('hooks',{}), indent=2))" 2>/dev/null
```

**Per-project overrides:** Check if `.claude/settings.local.json` exists:
```bash
cat .claude/settings.local.json 2>/dev/null || echo "NO OVERRIDE — using global defaults"
```

### Step 3: Compare Against Profile

For the matched profile, compare:

| Category | Profile Field | Loaded From | Comparison |
|----------|--------------|-------------|------------|
| Skills | `skills.allow` | `~/.claude/skills/` dirs | List extras not in allow list |
| MCPs | `mcps.block` | `.mcp.json` + parent + global | List blocked MCPs still active |
| Hooks | `hooks: false` | Global settings.json | Check if hooks are disabled |
| Agents | `agents.allow` | System prompt (can't audit directly) | List for CLAUDE.md |

### Step 4: Report

```text
=== CONTEXT CHECK: taskowl ===
Identity: taskowlClaude

SKILLS (10 allowed, 42 loaded):
  ✅ Allowed: context7, commit, github, pr-loop, coderabbit, never-fabricate
  ❌ Extra (32): coach, cmux-agents, figma-swarm, orchestrator-status, ...
  ⚠️  Wasted: ~5.2k tokens (~2.6% of 200k context)

MCPs (2 allowed, 7 loaded):
  ✅ Active: linear, context7
  ❌ Should block: brainlayer, voicelayer, supabase
  ℹ️  Can't block (global): exa, notebooklm

HOOKS:
  ❌ BrainLayer hooks ACTIVE (profile says: disabled)
  ⚠️  Estimated overhead: ~500 tokens per prompt

AGENTS:
  ✅ Allowed: general-purpose, Explore
  ❌ In system prompt but irrelevant: coach, orchestrator, jobs, services, ...

OVERRIDE FILE: .claude/settings.local.json
  [EXISTS / MISSING / STALE]

TOTAL WASTE ESTIMATE: ~6.1k tokens (3% of context) + hook overhead
```

### Step 5: Fix (--fix mode only)

If the user passed `--fix` or you're in fix mode:

**1. Generate `.claude/settings.local.json`:**

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

Populate `disabledMcpjsonServers` from `mcps.block` in the profile.
If `hooks: false`, override SessionStart and UserPromptSubmit with empty hooks arrays.

**2. Generate CLAUDE.md containerization section:**

Add to the project's CLAUDE.md (create if needed, append if exists):

```markdown
## CONTAINERIZATION

**You are [identity]. You work ONLY on this app.**

### Skill Allowlist — ONLY Use These
[Generate table from profile.skills.allow]

### Project Rules
[Generate from profile.rules]
```

**3. Create `.claude/` dir if needed:**
```bash
mkdir -p .claude
```

**4. Verify:**
After generating, re-run the audit to confirm waste is reduced.

## Token Estimation

Rough token counts for waste estimation:
- Each skill description in `~/.claude/skills/`: ~150 tokens average
- Each MCP tool description: ~100 tokens average
- BrainLayer hooks per prompt: ~300-800 tokens
- Memory file injection: ~200-500 tokens per hook

Formula: `waste = (extra_skills * 150) + (blocked_mcps_tools * 100) + (hooks_if_disabled * 500)`

## Platform Features vs Universal Fallbacks

> Claude Code has full audit + fix. Other CLIs have partial support.
> Full adapter docs: [adapters/](adapters/)

| Feature | Claude Code | Universal Fallback |
|---------|-------------|-------------------|
| **MCP audit** | `/mcp` command + parse settings.json | N/A — other CLIs have no MCP |
| **Hook audit** | Parse settings.json hooks section | N/A — other CLIs have no hooks |
| **Skills audit** | `ls ~/.claude/skills/` | Same command (shared skill dir) |
| **Fix: MCP disable** | `disabledMcpjsonServers` in settings.local.json | Comment out in .mcp.json manually |
| **Fix: Hook disable** | Override hooks to `[]` in settings.local.json | N/A |
| **Fix: Containerization** | settings.local.json + CLAUDE.md section | CLAUDE.md section only (+ .cursor/rules/ for Cursor) |
| **Registry lookup** | Read `~/.golems/config.yaml` contextProfiles | Same (shared config file) |

---

## Integration with Maintenance Golem

This skill is Component C2 of the Maintenance Golem (Wave 8).
Design doc: `$ORCHESTRATOR_REPO/designs/maintenance-golem.md`

The nightly maintenance squad (C4) runs this skill across ALL projects weekly to detect config drift.
