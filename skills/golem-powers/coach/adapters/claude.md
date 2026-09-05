# Claude Code — coach Adapter

> Claude-specific syntax for the coach skill. Memory-first pattern requires MCP access.

## MCP Tools Available (Claude-only)

| Tool | Use |
|------|-----|
| `brain_search(query)` | Look up past decisions, preferences, patterns |
| `brain_store(content, tags, importance)` | Persist coaching outcomes across sessions |
| `brain_entity(query)` | Look up people, clients, companies |
| `mcp__claude_ai_Google_Calendar__*` | Create, read, update calendar events |
| `mcp__claude_ai_Gmail__*` | Read email threads, create drafts |
| `voice_speak(message)` / `voice_ask(message)` | Voice mode (VoiceLayer) |

## Memory-First Pattern (Claude-only)

```bash
# Before ANY response — search for context
brain_search("coach <topic>")
brain_search("<person name> <context>")

# After coaching session — store outcomes
brain_store(
  content: "Coach: <what happened, what was decided>",
  tags: ["coach", "<domain>", "agent:coachClaude"],
  importance: 7
)
```

## Calendar via MCP

```bash
# Create event
mcp__claude_ai_Google_Calendar__gcal_create_event(
  summary: "Job search block",
  start: "2026-03-12T09:00:00+02:00",
  end: "2026-03-12T10:00:00+02:00",
  colorId: "7"  # Peacock = work
)

# Fallback if MCP fails:
# Write to ~/.golems-zikaron/coach/schedule-YYYY-MM-DD.md
```

## Unique Capabilities

- Full BrainLayer MCP (brain_search, brain_store, brain_entity) — core of coach skill
- Google Calendar + Gmail MCP — scheduling and correspondence
- VoiceLayer MCP — voice mode sessions
- Obsidian file reads — diary, client notes
- `op` CLI for credential retrieval
