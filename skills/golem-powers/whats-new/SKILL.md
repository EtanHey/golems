---
name: whats-new
description: "Compare Claude/Codex/Cursor/Wispr changelogs to local setup. Triggers: whats new, changelog, updates."
---

# /whats-new — Changelog Cross-Reference

> Inspired by Brad Feld's whats-new plugin. Our version tracks FOUR products and cross-references against the full golems ecosystem.

## What This Skill Does

Fetches the latest release notes for tools you depend on, diffs them against your actual configuration, and produces a structured report of:

1. **BREAKING / AFFECTS YOU** -- changes that directly touch something in your setup
2. **NEW CAPABILITY** -- features you should consider adopting given what you already use
3. **FYI** -- everything else, collapsed to one-liners

## CRITICAL: Changelog Size Limits

> **NEVER fetch a full changelog page via crawling_exa with maxCharacters > 3000.**
> The Anthropic changelog alone is 200K+ characters. Fetching it causes "result exceeds maximum" errors
> and the skill fails. Always use: GitHub API (preferred), freshness-scoped search, OR crawling with
> maxCharacters: 3000 (gets only the most recent entries at the top of the page).
> This applies to ALL products — Claude Code, Codex CLI, Cursor CLI, and Wispr Flow release pages all grow over time.

## Products Tracked

### 1. Claude Code

**Changelog source:** GitHub Releases API (primary), Anthropic docs (fallback)

**How to fetch (tiered approach):**

```bash
# Step 0: Check installed version
claude --version
```

```bash
# Step 1 (PRIMARY — GitHub API): Last 5 releases with full release notes
curl -s "https://api.github.com/repos/anthropics/claude-code/releases?per_page=5"
```

This returns structured JSON with tag_name, body (release notes), and published_at. Most reliable for recent releases.

```bash
# Step 2 (FALLBACK — exa search with freshness cascade):
# Try last week first:
mcp__exa__web_search_exa(query: "Claude Code changelog [INSTALLED_VERSION]", freshness: "week", includeDomains: ["docs.anthropic.com", "github.com/anthropics"])

# If no results, expand to last month:
mcp__exa__web_search_exa(query: "Claude Code changelog latest release", freshness: "month", includeDomains: ["docs.anthropic.com", "github.com/anthropics"])
```

```bash
# Step 3 (LAST RESORT — crawl only the top of the page):
# maxCharacters: 3000 gets only the most recent entries at the top
mcp__exa__crawling_exa(urls: ["https://docs.anthropic.com/en/docs/claude-code/changelog"], maxCharacters: 3000)
```

### 2. Wispr Flow

**Changelog source:** `https://releasebot.io/updates/wispr-flow` or `https://wisprflow.ai/changelog`

**How to fetch:**

```bash
mcp__exa__crawling_exa(urls: ["https://releasebot.io/updates/wispr-flow"], maxCharacters: 3000)
```

**Alternative:**

```bash
mcp__exa__web_search_exa(query: "Wispr Flow changelog release notes latest", freshness: "month", includeDomains: ["wisprflow.ai", "releasebot.io"])
```

### 3. Codex CLI (OpenAI)

**Changelog source:** `https://developers.openai.com/codex/changelog`

**How to fetch (tiered approach):**

```bash
# Check installed version
codex --version 2>/dev/null || npx @openai/codex --version
```

```bash
# Step 1 (PRIMARY — exa search with freshness cascade):
# Try last week first:
mcp__exa__web_search_exa(query: "OpenAI Codex CLI changelog latest release", freshness: "week", includeDomains: ["developers.openai.com", "github.com/openai"])

# If no results, expand to last month:
mcp__exa__web_search_exa(query: "OpenAI Codex CLI changelog latest release", freshness: "month", includeDomains: ["developers.openai.com", "github.com/openai"])
```

```bash
# Step 2 (FALLBACK — crawl only the top of the page):
mcp__exa__crawling_exa(urls: ["https://developers.openai.com/codex/changelog"], maxCharacters: 3000)
```

### 4. Cursor CLI

**Changelog source:** `https://cursor.sh/changelog` or `https://www.cursor.com/changelog`

**How to fetch (tiered approach):**

```bash
# Check installed version
cursor --version 2>/dev/null
```

```bash
# Step 1 (PRIMARY — exa search with freshness cascade):
# Try last week first:
mcp__exa__web_search_exa(query: "Cursor IDE CLI changelog latest release agent mode", freshness: "week", includeDomains: ["cursor.com", "cursor.sh"])

# If no results, expand to last month:
mcp__exa__web_search_exa(query: "Cursor IDE CLI changelog latest release agent mode", freshness: "month", includeDomains: ["cursor.com", "cursor.sh"])
```

```bash
# Step 2 (FALLBACK — crawl only the top of the page):
mcp__exa__crawling_exa(urls: ["https://www.cursor.com/changelog"], maxCharacters: 3000)
```

---

## Cross-Reference Targets

For each changelog entry, check it against these configuration surfaces:

### A. Claude Code Settings (`~/.claude/settings.json`)

```bash
cat ~/.claude/settings.json
```

Cross-reference against:
- **hooks** -- SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart/Stop, SessionEnd, Stop. Any changelog mentioning hook lifecycle, timing, or new hook types.
- **permissions.allow** -- Tool permission patterns. Any changelog mentioning permission syntax, new tools, or security changes.
- **enabledPlugins** -- Installed plugins. Any changelog about plugin system, marketplace, or specific plugins.
- **mcpServers** -- MCP server configs. Any changelog about MCP protocol, OAuth, dedup, or server handling.
- **statusLine** -- Status line config. Any changelog about status display or terminal rendering.
- **Other settings** -- alwaysThinkingEnabled, effortLevel, voiceEnabled, autoUpdatesChannel, etc.

### B. Skills (`~/.claude/skills/`)

```bash
ls ~/.claude/skills/
```

Cross-reference against:
- Skill loading, frontmatter parsing (paths:, if:, description length caps)
- Slash command changes
- Conditional skill activation changes

### C. Hooks (`~/.claude/hooks/`)

```bash
ls ~/.claude/hooks/
```

Cross-reference against:
- Hook execution model changes (timeout, async, ordering)
- New hook types (e.g., TaskCreated, WorktreeCreate)
- Hook matching syntax changes
- New fields (e.g., `if` conditional field, `updatedInput` in PreToolUse)

### D. MCP Servers Across Repos

```bash
# Global MCP config
cat ~/.claude/.mcp.json 2>/dev/null || echo "No global .mcp.json"

# Find all repo-level MCP configs
find ~/Gits -maxdepth 2 -name ".mcp.json" -type f 2>/dev/null
```

Cross-reference against:
- MCP protocol changes (OAuth, tool description caps, dedup rules)
- New MCP environment variables (CLAUDE_CODE_MCP_SERVER_NAME, etc.)
- MCP server instruction handling changes
- Server connection timeout or caching changes

### E. VoiceBar Competitive Intel (`$HOME/Gits/voicelayer/`)

For Wispr Flow changes specifically:
- New voice features that VoiceBar should match or differentiate from
- Platform expansions (Android, iOS, Windows) -- competitive positioning
- Developer-focused features (variable recognition, file tagging) -- overlap with VoiceBar's target
- Team/enterprise features -- future roadmap consideration

### F. repoGolem Launchers (Codex + Cursor routing)

```bash
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"
cat ~/.golems/config.yaml 2>/dev/null | head -50
# Or check registry
cat "$ORCHESTRATOR_REPO/repoGolem/registry.json" 2>/dev/null | python3 -c "import json,sys; [print(k) for k in json.load(sys.stdin).keys()]"
```

Cross-reference against:
- **Codex CLI flags** -- `--model`, `--approval-mode`, `--quiet`, `--full-auto`. Any new flags = update launchers.
- **Cursor CLI flags** -- `--model`, `--output-format text`, `--trust`. Any new flags = update audit scripts.
- **Model availability** -- new models (e.g., `gpt-5.5` / `gpt-5.5-codex` rolling out from 2026-04-23, claude-opus-4-7, etc.) affect routing in `standards/agents.md` and `/agent-routing` SKILL.md. Refresh stale model-name strings when a new tier becomes the recommended default.
- **Agent mode changes** -- Cursor background agents, Codex sandbox mode, new permission models
- **Rate limits / quotas** -- Codex hit OpenAI usage limit (confirmed Mar 30). Track quota changes.

### G. Plugins (`enabledPlugins` in settings.json)

```bash
cat ~/.claude/settings.json | python3 -c "import json,sys; d=json.load(sys.stdin); [print(k) for k in d.get('enabledPlugins', {}).keys()]"
```

Cross-reference against:
- Plugin API changes, marketplace changes
- Specific plugin updates (coderabbit, frontend-design, skill-creator, etc.)
- Organization policy changes affecting plugins

---

## Execution Procedure

### Step 0: Schema Snapshot & Diff (reverse-engineering undocumented changes)

Save a snapshot of the current Claude Code CLI surface and diff against the previous version:

```bash
# Save current snapshot
ver=$(claude --version | head -1 | awk '{print $1}')
snapshot_dir=~/.claude/schema-snapshots
mkdir -p "${snapshot_dir}"

version_sort() {
  if command -v gsort >/dev/null 2>&1; then
    gsort -V
  else
    python3 -c 'import re, sys
def key(value):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"([0-9]+)", value.rstrip())]
for line in sorted((line.rstrip("\n") for line in sys.stdin if line.strip()), key=key):
    print(line)'
  fi
}

find_previous_snapshot() {
  pattern="$1"
  current_file="$2"
  find "${snapshot_dir}" -maxdepth 1 -name "${pattern}" -type f 2>/dev/null \
    | version_sort \
    | grep -F -v "${current_file}" \
    | tail -1
}

# CLI help (all flags)
claude --help > "${snapshot_dir}/help-${ver}.txt" 2>&1

# Environment variables (from installed package)
pkg_path=""
if npm_root=$(npm root -g); then
  candidate="${npm_root}/@anthropic-ai/claude-code"
  if [ -f "${candidate}/cli.mjs" ]; then
    pkg_path="${candidate}"
  fi
fi
if [ -z "${pkg_path}" ]; then
  claude_bin=$(command -v claude)
  claude_real=$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${claude_bin}")
  if candidate=$(cd "$(dirname "${claude_real}")/../lib/node_modules/@anthropic-ai/claude-code" 2>/dev/null && pwd); then
    if [ -f "${candidate}/cli.mjs" ]; then
      pkg_path="${candidate}"
    fi
  fi
fi
if [ -z "${pkg_path}" ]; then
  echo "Error: could not locate @anthropic-ai/claude-code via npm root -g or the claude binary layout" >&2
  exit 1
fi
grep -rohE "CLAUDE_CODE_[A-Z_]+" "${pkg_path}/cli.mjs" | sort -u > "${snapshot_dir}/envvars-${ver}.txt"

# Find previous snapshot
prev=$(find_previous_snapshot "help-[0-9]*.txt" "${snapshot_dir}/help-${ver}.txt")

# Codex CLI snapshot
prev_codex=""
if command -v codex >/dev/null 2>&1; then
  codex_bin=$(command -v codex)
  codex_ver=$(codex --version 2>/dev/null || echo unknown)
  codex --help > "${snapshot_dir}/help-codex-${codex_ver}.txt" 2>&1
  if [ -n "${codex_bin}" ]; then
    grep -aohE "CODEX_[A-Z_]+" "${codex_bin}" 2>/dev/null | sort -u > "${snapshot_dir}/envvars-codex-${codex_ver}.txt"
  fi
  prev_codex=$(find_previous_snapshot "help-codex-*.txt" "${snapshot_dir}/help-codex-${codex_ver}.txt")
fi

# Gemini CLI snapshot
prev_gemini=""
if command -v gemini >/dev/null 2>&1; then
  gemini_bin=$(command -v gemini)
  gemini_ver=$(gemini --version 2>/dev/null | head -1)
  [ -n "${gemini_ver}" ] || gemini_ver=unknown
  gemini --help > "${snapshot_dir}/help-gemini-${gemini_ver}.txt" 2>&1
  if [ -n "${gemini_bin}" ]; then
    grep -aohE "GEMINI_[A-Z_]+" "${gemini_bin}" 2>/dev/null | sort -u > "${snapshot_dir}/envvars-gemini-${gemini_ver}.txt"
  fi
  prev_gemini=$(find_previous_snapshot "help-gemini-*.txt" "${snapshot_dir}/help-gemini-${gemini_ver}.txt")
fi

# Cursor CLI snapshot
prev_cursor=""
if command -v cursor >/dev/null 2>&1; then
  cursor_bin=$(command -v cursor)
  cursor_ver=$(cursor --version 2>/dev/null || echo unknown)
  cursor --help > "${snapshot_dir}/help-cursor-${cursor_ver}.txt" 2>&1
  if [ -n "${cursor_bin}" ]; then
    grep -aohE "CURSOR_[A-Z_]+" "${cursor_bin}" 2>/dev/null | sort -u > "${snapshot_dir}/envvars-cursor-${cursor_ver}.txt"
  fi
  prev_cursor=$(find_previous_snapshot "help-cursor-*.txt" "${snapshot_dir}/help-cursor-${cursor_ver}.txt")
fi
```

If a previous snapshot exists, diff:

```bash
if [ -n "$prev" ]; then
  prev_ver=$(basename "$prev" | sed 's/help-//;s/.txt//')
  echo "=== Diffing v${prev_ver} \u2192 v${ver} ==="

  # New CLI flags
  diff <(grep '^\s*--' "${snapshot_dir}/help-${prev_ver}.txt" | sort) \
       <(grep '^\s*--' "${snapshot_dir}/help-${ver}.txt" | sort) | grep '^>'

  # New env vars
  diff "${snapshot_dir}/envvars-${prev_ver}.txt" \
       "${snapshot_dir}/envvars-${ver}.txt" | grep '^>'
fi

if [ -n "$prev_codex" ] && [ -n "${codex_ver:-}" ]; then
  prev_codex_ver=$(basename "$prev_codex" | sed 's/help-codex-//;s/.txt//')
  echo "=== Diffing Codex ${prev_codex_ver} -> ${codex_ver} ==="

  diff <(grep '^\s*--' "${snapshot_dir}/help-codex-${prev_codex_ver}.txt" | sort) \
       <(grep '^\s*--' "${snapshot_dir}/help-codex-${codex_ver}.txt" | sort) | grep '^>'

  diff "${snapshot_dir}/envvars-codex-${prev_codex_ver}.txt" \
       "${snapshot_dir}/envvars-codex-${codex_ver}.txt" | grep '^>'
fi

if [ -n "$prev_gemini" ] && [ -n "${gemini_ver:-}" ]; then
  prev_gemini_ver=$(basename "$prev_gemini" | sed 's/help-gemini-//;s/.txt//')
  echo "=== Diffing Gemini ${prev_gemini_ver} -> ${gemini_ver} ==="

  diff <(grep '^\s*--' "${snapshot_dir}/help-gemini-${prev_gemini_ver}.txt" | sort) \
       <(grep '^\s*--' "${snapshot_dir}/help-gemini-${gemini_ver}.txt" | sort) | grep '^>'

  diff "${snapshot_dir}/envvars-gemini-${prev_gemini_ver}.txt" \
       "${snapshot_dir}/envvars-gemini-${gemini_ver}.txt" | grep '^>'
fi

if [ -n "$prev_cursor" ] && [ -n "${cursor_ver:-}" ]; then
  prev_cursor_ver=$(basename "$prev_cursor" | sed 's/help-cursor-//;s/.txt//')
  echo "=== Diffing Cursor ${prev_cursor_ver} -> ${cursor_ver} ==="

  diff <(grep '^\s*--' "${snapshot_dir}/help-cursor-${prev_cursor_ver}.txt" | sort) \
       <(grep '^\s*--' "${snapshot_dir}/help-cursor-${cursor_ver}.txt" | sort) | grep '^>'

  diff "${snapshot_dir}/envvars-cursor-${prev_cursor_ver}.txt" \
       "${snapshot_dir}/envvars-cursor-${cursor_ver}.txt" | grep '^>'
fi
```

**Any new flags or env vars found = classify as "AFFECTS YOU" automatically**, even if no changelog mentions them. These are undocumented changes that the changelog fetch in Step 3 might miss.

**Why this matters:** Claude Code publishes to npm faster than changelogs update. Versions 2.1.102-104 had zero release notes but contained actual new flags (--bare, --tmux, --brief, CLAUDE_CODE_AGENT_COST_STEER, CLAUDE_CODE_AUTO_COMPACT_WINDOW) discoverable only through binary introspection.

### Step 1: Gather Current State

Run ALL of these in parallel (independent data gathering):

```bash
# Current versions
claude --version
codex --version 2>/dev/null || echo "codex: check npx @openai/codex --version"
cursor --version 2>/dev/null || echo "cursor: not installed or not in PATH"

# Settings
cat ~/.claude/settings.json

# Skills count
ls ~/.claude/skills/ | wc -l

# Hooks
ls ~/.claude/hooks/

# Plugins list
cat ~/.claude/settings.json | python3 -c "import json,sys; d=json.load(sys.stdin); [print(k) for k in d.get('enabledPlugins', {}).keys()]"

# repoGolem registry (launcher configs)
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"
cat "$ORCHESTRATOR_REPO/repoGolem/registry.json" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d)} launchers registered')"
```

### Step 2: Check BrainLayer for Last Review

```bash
brain_search("whats-new changelog review last version")
```

If a prior review exists, note the last-reviewed versions. Only analyze entries AFTER those versions.

### Step 3: Fetch Changelogs

Use the last-reviewed version from Step 2 (BrainLayer) to scope what you fetch. For each product, follow the tiered fetch strategy — try each step in order, stop when you get useful results.

**Claude Code (3-tier):**

```bash
# Tier 1 (PRIMARY): GitHub Releases API — structured, reliable, always current
curl -s "https://api.github.com/repos/anthropics/claude-code/releases?per_page=5"
```

```bash
# Tier 2 (FALLBACK): exa search with freshness cascade
mcp__exa__web_search_exa(query: "Claude Code changelog [INSTALLED_VERSION]", freshness: "week", includeDomains: ["docs.anthropic.com", "github.com/anthropics"])
# If empty, try freshness: "month"
mcp__exa__web_search_exa(query: "Claude Code changelog latest release", freshness: "month", includeDomains: ["docs.anthropic.com", "github.com/anthropics"])
```

```bash
# Tier 3 (LAST RESORT): Crawl only the top of the changelog page
mcp__exa__crawling_exa(urls: ["https://docs.anthropic.com/en/docs/claude-code/changelog"], maxCharacters: 3000)
```

**Wispr Flow:**

```bash
mcp__exa__crawling_exa(urls: ["https://releasebot.io/updates/wispr-flow"], maxCharacters: 3000)
```

**Codex CLI (2-tier):**

```bash
# Tier 1: exa search with freshness cascade
mcp__exa__web_search_exa(query: "OpenAI Codex CLI changelog latest release", freshness: "week", includeDomains: ["developers.openai.com", "github.com/openai"])
# If empty, try freshness: "month"
mcp__exa__web_search_exa(query: "OpenAI Codex CLI changelog latest release", freshness: "month", includeDomains: ["developers.openai.com", "github.com/openai"])
```

```bash
# Tier 2: Crawl only the top of the changelog page
mcp__exa__crawling_exa(urls: ["https://developers.openai.com/codex/changelog"], maxCharacters: 3000)
```

**Cursor CLI (2-tier):**

```bash
# Tier 1: exa search with freshness cascade
mcp__exa__web_search_exa(query: "Cursor IDE CLI changelog latest release agent mode", freshness: "week", includeDomains: ["cursor.com", "cursor.sh"])
# If empty, try freshness: "month"
mcp__exa__web_search_exa(query: "Cursor IDE CLI changelog latest release agent mode", freshness: "month", includeDomains: ["cursor.com", "cursor.sh"])
```

```bash
# Tier 2: Crawl only the top of the changelog page
mcp__exa__crawling_exa(urls: ["https://www.cursor.com/changelog"], maxCharacters: 3000)
```

### Step 4: Cross-Reference and Classify

Step 0 schema diffs are pre-classified as AFFECTS YOU. Merge them with changelog findings -- if a flag appears in BOTH the schema diff AND the changelog, prefer the changelog description.

For EACH changelog entry, classify into exactly one category:

**AFFECTS YOU (priority: critical)**
The change touches a specific config you have. Examples:
- "Fixed PreToolUse hooks..." -- you have 4 PreToolUse hooks
- "MCP tool descriptions capped at 2KB" -- you have 5 MCP servers
- "Skill descriptions capped at 250 chars" -- you have 50+ skills
- "Fixed hooks on macOS" -- you're on macOS
- "Voice push-to-talk fix" -- you have voiceEnabled: true

**NEW CAPABILITY (priority: medium)**
The change adds something you don't use yet but should consider. Examples:
- "Added conditional `if` field for hooks" -- you could optimize your PreToolUse hooks
- "Added TaskCreated hook" -- you have subagent workflows that could benefit
- "New env var for MCP headers" -- you manage multiple MCP servers

**FYI (priority: low)**
Everything else. Windows fixes, VSCode-only changes, features for plans you don't have, etc.

### Step 5: Generate Report

Use this exact format:

```markdown
# What's New -- YYYY-MM-DD

## Versions Checked
- **Claude Code:** vX.Y.Z (installed) | changelog up to vA.B.C
- **Codex CLI:** vX.Y.Z (installed) | changelog up to vA.B.C
- **Cursor CLI:** vX.Y.Z (installed) | changelog up to vA.B.C
- **Wispr Flow:** latest release (YYYY-MM-DD)
- **Last reviewed:** vX.Y.Z (Claude Code) / YYYY-MM-DD (others)

---

## AFFECTS YOU

### [Claude Code / Wispr Flow] -- Short description
**What changed:** One-line summary
**Your config:** Which specific file/setting is affected
**Action needed:** What to check, change, or test
**Risk:** HIGH / MEDIUM / LOW

---

## NEW CAPABILITIES

### [Claude Code / Wispr Flow] -- Short description
**What's new:** One-line summary
**Why it matters for you:** How this intersects with your current setup
**Adoption effort:** TRIVIAL / SMALL / MEDIUM
**Suggested action:** Concrete next step

---

## FYI
- [CC] Fixed VSCode extension showing "Not responding" during long ops
- [CC] Improved PowerShell dangerous command detection
- [WF] Android early access launched
- ...

---

## VoiceBar Competitive Notes
_(Only if Wispr Flow had relevant updates)_
- **Feature gap:** [what Wispr added that VoiceBar lacks]
- **Differentiation opportunity:** [where VoiceBar is ahead or different]
- **No action needed:** [parity features or irrelevant platform updates]
```

### Step 6: Store in BrainLayer

```bash
brain_store(
  content: "whats-new review YYYY-MM-DD: Claude Code vX.Y.Z, Codex vX.Y.Z, Cursor vX.Y.Z, Wispr Flow latest. AFFECTS: [count] items ([summary]). NEW CAPABILITIES: [count] items ([summary]). Key actions: [list]. VoiceBar notes: [summary].",
  tags: ["whats-new", "changelog", "claude-code", "codex-cli", "cursor-cli", "wispr-flow", "<YYYY-MM-DD>"],
  importance: 7
)
```

### Step 7: Notify if Critical

If any AFFECTS YOU item has risk HIGH:

```bash
notify "Whats New" "HIGH risk change in [product]: [summary]. Check [config file]."
```

---

## Usage Examples

### Default: Check everything since last review

```bash
/whats-new
```

### Check specific Claude Code version

```bash
/whats-new 2.1.85
```

_(Shows only changes from that version onward)_

### Quick check after update

```bash
/whats-new --quick
```

_(Only AFFECTS YOU items, skip FYI)_

### Wispr Flow only

```bash
/whats-new --wispr
```

---

## When to Run

- **After `claude --version` shows a new version** -- mandatory
- **Weekly during maintenance** -- as part of ecosystem-health routine
- **After hearing about updates** in community channels
- **When something breaks unexpectedly** -- check if a recent update caused it
- **Proactively** -- the changelog moves fast, don't fall behind

For a release-day rules check, use a clean temporary worktree or sandbox: record a
baseline, temporarily remove two or three candidate rule files there, and keep a
deletion only after a predefined non-destructive task matrix passes without changing
the active workspace.

---

## Edge Cases

- **Exa is down:** Fall back to `WebSearch` or `WebFetch` for changelog URLs. Report that live data was unavailable.
- **GitHub API rate-limited:** Fall through to exa Tier 2/3. Note the rate limit in the report.
- **No prior review in BrainLayer:** Assume first run. Show last 2-3 versions of Claude Code + last 2 Wispr Flow releases.
- **Changelog format changed:** If the page structure doesn't match expected format, flag it and attempt best-effort parsing.
- **Version not found:** If `--version` flag doesn't match any changelog entry, show the closest match and note the gap.
- **Exa search returns nothing for "week":** Expand to "month". If "month" also empty, use crawling with maxCharacters: 3000 as last resort.
- **No previous schema snapshot:** First run. Save snapshot, skip diff, note "baseline established" in the report.
