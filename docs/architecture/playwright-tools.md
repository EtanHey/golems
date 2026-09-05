# Playwright Tools for Golems (Architecture Decision)

> Decided: 2026-02-14

## Context

Phase 8 of the Dashboard Consolidation plan adds a Playwright pipeline for browser automation (screenshots, OG images, web scraping for visual content). Researched available tools.

## Options Evaluated

| Tool | Stars | What | When to Use |
|------|-------|------|-------------|
| **`@playwright/mcp`** (Microsoft official) | 27K | MCP server — accessibility-tree based browser control | CC-driven screenshot/scrape tasks via MCP tools |
| **`lackeyjb/playwright-skill`** | 1.6K | CC Skill — model-invoked, writes + runs custom Playwright scripts | Complex multi-step automation where CC generates custom scripts |
| **`anthropics/claude-plugins-official` → `playwright`** | — | Official CC plugin wrapping Microsoft MCP | Easy install via `/plugin install` (thin wrapper) |
| **`ed3d-playwright`** | ~500 | Community MCP — batteries-included (screenshot, PDF, scrape, form fill) | If you need preset actions without accessibility-tree parsing |

## Decision

**Primary: Microsoft `@playwright/mcp`** — the real underlying technology. 27K stars, actively maintained by Microsoft. Accessibility-tree based means it understands page structure semantically.

**Complement: `lackeyjb/playwright-skill`** — for model-invoked scripting when MCP approach is too token-heavy. Microsoft recommends CLI+Skills over MCP for coding agents.

**Skip: Anthropic official plugin** — just a thin wrapper that installs the Microsoft MCP. Functionally identical, the plugin just saves editing `.mcp.json` manually.

**Skip: `ed3d-playwright`** — community project, less maintained, preset actions are limiting.

## MCP Config

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@0.0.79"]
    }
  }
}
```

## Token Efficiency Note

Microsoft's docs state that for **coding agents**, CLI+Skills (like `lackeyjb/playwright-skill`) are more token-efficient than MCP because:
- MCP sends full accessibility tree on each action (verbose)
- Skills let the model write targeted scripts (focused)

Evaluate both during Phase 8 implementation.

## Rationale

- Microsoft MCP is the industry standard (27K stars vs <2K for alternatives)
- Accessibility-tree approach is more robust than raw DOM scraping
- Having both MCP (for simple tasks) and Skills (for complex scripting) covers all use cases
- The Anthropic plugin adds no value over direct MCP config
