# Products Tracked and Cross-Reference Targets

> Moved out of `../SKILL.md` (GO-3 PR-7) so the procedure stays readable; SKILL.md keeps the index.

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
- **Model availability** -- compare new models against `/agent-routing` `references/model-and-effort.md`; that reference owns current Codex model and effort strings.
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


## Report section: VoiceBar Competitive Notes

Append this block to the report template (Step 5) only when Wispr Flow had relevant updates:

```markdown
## VoiceBar Competitive Notes
_(Only if Wispr Flow had relevant updates)_
- **Feature gap:** [what Wispr added that VoiceBar lacks]
- **Differentiation opportunity:** [where VoiceBar is ahead or different]
- **No action needed:** [parity features or irrelevant platform updates]
```
