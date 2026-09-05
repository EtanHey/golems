---
name: context7
description: "Use when needing current API references, function signatures, or library usage patterns. Looks up documentation via Context7 API. Covers docs lookup, library documentation, API reference, how to use library. NOT for: web search (use WebSearch), project-specific code (read the codebase)."
execute: scripts/default.sh
---

# Context7 - Library Documentation Lookup

> Look up current library documentation using Context7 API.

Context7 provides up-to-date documentation and code examples for programming libraries. **Prefer the Context7 MCP tools** (`mcp__context7__*`) when available — they're simpler. Use this skill as a fallback when the MCP is unavailable or for scripted/batch lookups.

## Quick Reference

| Action | Script | Example |
|--------|--------|---------|
| Search for library | `scripts/resolve-library.sh` | `./resolve-library.sh react` |
| Query documentation | `scripts/query-docs.sh` | `./query-docs.sh /vercel/next.js 'app router'` |
| Show usage | `scripts/default.sh` | Auto-runs when skill loaded |

## Usage

### 1. Find a Library ID

First, search for the library to get its Context7 ID:

```bash
./scripts/resolve-library.sh react
```

Output example:
```markdown
## Library Search Results

| Name | ID | Snippets | Score |
|------|-----|----------|-------|
| React | /facebook/react | 1250 | 95 |
| React Native | /facebook/react-native | 890 | 92 |
```

### 2. Query Documentation

Then use the library ID to query specific documentation:

```bash
./scripts/query-docs.sh /vercel/next.js 'how to use app router'
```

Output: Markdown-formatted documentation snippets with code examples.

## Authentication

The scripts automatically get the API key from:

1. **Environment variable** `CONTEXT7_API_KEY` (if set)
2. **1Password** - item `context7` in vault `development`, field `API_KEY`

### 1Password Setup (Recommended)

The key is already stored in 1Password. No setup needed if you have `op` CLI authenticated.

### Manual Setup

If not using 1Password, set the environment variable:

```bash
export CONTEXT7_API_KEY="ctx7sk_your_key_here"
```

Get a key from [context7.com](https://context7.com) → API settings.

## Disabling Context7 MCP (Optional)

If you want to use only this skill and reduce MCP overhead:

### In Claude Code

Edit your MCP config (`~/.config/claude-code/mcp.json` or `mcp_config.json`):

```json
{
  "mcpServers": {
    "context7": {
      "disabled": true
    }
  }
}
```

Or remove the entry entirely.

### In Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) and remove or disable the context7 server.

## Workflows

- [lookup.md](workflows/lookup.md) - Step-by-step library documentation lookup

## API Reference

This skill calls the Context7 REST API:

- **Base URL:** `https://context7.com/api`
- **Search endpoint:** `GET /v2/libs/search?query=...&libraryName=...`
- **Docs endpoint:** `GET /v2/context?query=...&libraryId=...&type=txt`
- **Auth:** Bearer token header

## Large File Processing

When Context7 returns large documentation blocks (>100 lines), avoid reading them directly into Opus context. Instead use:

```bash
# Summarize large docs with external model
scripts/summarize-file.sh <file> "<what you need>" [gemini|cursor|kiro|haiku]
```

Or delegate to a subagent that writes a summary to a scratchpad file.

## See Also

- [Context7 Documentation](https://context7.com/docs)
- [skill-creator](../../skill-creator/) - Create, edit, audit, and evaluate golem-powers skills
