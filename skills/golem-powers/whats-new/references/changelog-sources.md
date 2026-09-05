# Changelog Sources Reference

## Claude Code

| Source | URL | Reliability |
|--------|-----|-------------|
| Official docs | https://docs.anthropic.com/en/docs/claude-code/changelog | Primary -- generated from GitHub CHANGELOG.md |
| GitHub CHANGELOG | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md | Upstream source |
| Local version | `claude --version` | Always available |
| LLMs.txt index | https://code.claude.com/docs/llms.txt | Discovery -- lists all doc pages |

### Claude Code Config Surfaces

| Surface | Path | What to check |
|---------|------|---------------|
| Global settings | `~/.claude/settings.json` | hooks, permissions, plugins, MCP, statusLine |
| Project settings | `.claude/settings.json` (per repo) | Per-repo overrides |
| Local settings | `.claude/settings.local.json` | Machine-local overrides (gitignored) |
| Managed settings | `managed-settings.json` | Org policy (enterprise) |
| Global instructions | `~/.claude/CLAUDE.md` | Global rules |
| Project instructions | `CLAUDE.md` (per repo) | Per-repo rules |
| Skills | `~/.claude/skills/*` | Installed skills |
| Hooks | `~/.claude/hooks/*` | Hook scripts |
| Agents | `~/.claude/agents/*` | Agent definitions |
| MCP global | `~/.claude/.mcp.json` | Global MCP servers |
| MCP per-repo | `.mcp.json` (per repo) | Per-repo MCP servers |
| Keybindings | `~/.claude/keybindings.json` | Custom keybindings |

### Key Claude Code Subsystems to Watch

- **Hooks lifecycle:** SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, SubagentStop, SessionEnd, Stop, TaskCreated, WorktreeCreate
- **MCP protocol:** OAuth, tool description caps, server dedup, headersHelper env vars
- **Plugin system:** Marketplace, enabledPlugins, plugin data dirs, org policy blocking
- **Skill system:** Frontmatter parsing, paths: globs, description caps, conditional activation
- **Agent system:** --agent flag, agent memory dirs, subagent tools
- **Tools:** Read, Write, Edit, Bash, Agent, Task, WebSearch, WebFetch, ToolSearch, Glob, Grep, NotebookEdit
- **Voice:** push-to-talk, voiceEnabled setting
- **Worktrees:** WorktreeCreate hook, --worktree flag
- **Terminal rendering:** Markdown, diff syntax, scroll, IME, keyboard protocols

## Codex CLI (OpenAI)

| Source | URL | Reliability |
|--------|-----|-------------|
| Official changelog | https://developers.openai.com/codex/changelog | Primary |
| npm package | https://www.npmjs.com/package/@openai/codex | Version history |
| GitHub | https://github.com/openai/codex | Source, issues, PRs |
| Local version | `codex --version` or `npx @openai/codex --version` | Always available |

### Codex CLI Config Surfaces

| Surface | Path | What to check |
|---------|------|---------------|
| repoGolem launchers | `$ORCHESTRATOR_REPO/repoGolem/registry.json` | Launcher flags per repo |
| Agent standards | `$ORCHESTRATOR_REPO/standards/agents.md` | Model routing rules |
| cmux-agents skill | `~/.claude/skills/cmux-agents` | Codex adapter patterns |
| Collab templates | `$ORCHESTRATOR_REPO/collab/TEMPLATE.md` | Codex worker dispatch patterns |

### Key Codex Subsystems to Watch

- **Model routing** -- `--model gpt-5.5` (current main pool default, recommended per 2026-04-23 announcement), `--model gpt-5.4-codex-xhigh` (legacy), new model tiers, pricing changes
- **Approval modes** -- `--approval-mode full-auto`, `--quiet`, sandbox permissions
- **Agent mode** -- background execution, file system access, tool availability
- **Rate limits** -- OpenAI usage quotas per tier (hit limit Mar 30, resets 6:01 AM)
- **CLI flags** -- new flags affect repoGolem launchers and cmux-agents adapters
- **Output format** -- `--output-format text` for audits, JSON for parsing

## Cursor CLI

| Source | URL | Reliability |
|--------|-----|-------------|
| Official changelog | https://www.cursor.com/changelog | Primary |
| Alternative | https://cursor.sh/changelog | Redirects to cursor.com |
| Local version | `cursor --version` | Always available |
| Forum | https://forum.cursor.com | Community reports of new features |

### Cursor CLI Config Surfaces

| Surface | Path | What to check |
|---------|------|---------------|
| repoGolem launchers | `$ORCHESTRATOR_REPO/repoGolem/registry.json` | Cursor launcher flags |
| Agent standards | `$ORCHESTRATOR_REPO/standards/agents.md` | Cursor routing (audits, research) |
| cmux-agents skill | `~/.claude/skills/cmux-agents` | Cursor adapter patterns |
| Audit scripts | `$ORCHESTRATOR_REPO/scripts/audit-runner.sh` | Cursor audit automation |

### Key Cursor Subsystems to Watch

- **Agent mode** -- `cursor agent` for background tasks, `--trust` for auto-approval
- **Model routing** -- Max Mode, model selection, Cursor Tab predictions
- **Background agents** -- PR review bots (`@cursor @bugbot review`), async execution
- **CLI flags** -- `--output-format text`, `--model`, workspace detection
- **Bug Bot** -- `@cursor @bugbot review` trigger syntax (NOT @CursorBot, NOT @cursor-bugbot)
- **MCP support** -- Cursor's MCP client capabilities, server compatibility
- **Rules files** -- `.cursorrules`, `.cursor/rules/` (their equivalent of CLAUDE.md)

## Wispr Flow

| Source | URL | Reliability |
|--------|-----|-------------|
| Releasebot feed | https://releasebot.io/updates/wispr-flow | Aggregated, slightly delayed |
| Official blog | https://wisprflow.ai/blog or https://wisprflow.ai/changelog | Primary |
| Docs | https://docs.wisprflow.ai | Support/troubleshooting |

### Wispr Flow Feature Areas

| Area | VoiceBar Relevance |
|------|-------------------|
| Transcription accuracy | DIRECT COMPETITOR -- compare with VoiceBar's edge-tts |
| Variable recognition | HIGH -- developer voice coding feature |
| File tagging (Cursor) | HIGH -- VoiceBar integrates with same IDEs |
| Styles/personalization | MEDIUM -- VoiceBar could differentiate |
| Team/enterprise | LOW -- VoiceBar is personal tool |
| Mobile (iOS/Android) | LOW -- VoiceBar is macOS desktop |
| Notes | LOW -- not in VoiceBar's scope |
| HIPAA/compliance | LOW -- VoiceBar is personal use |
