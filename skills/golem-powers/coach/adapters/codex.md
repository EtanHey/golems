# Codex CLI — coach Adapter

> ⚠️ Codex is NOT recommended for coach tasks. The core memory pattern requires BrainLayer MCP.

## Critical Gap: No MCP Access

The coach skill's primary value is **persistent memory across sessions** via BrainLayer. Without MCP:

| Feature | Status | Impact |
|---------|--------|--------|
| `brain_search` | ❌ Unavailable | No past context — every session starts from zero |
| `brain_store` | ❌ Unavailable | Outcomes not persisted — corrections lost |
| Google Calendar MCP | ❌ Unavailable | Can't create/read calendar events |
| Gmail MCP | ❌ Unavailable | Can't read correspondence |
| VoiceLayer MCP | ❌ Unavailable | No voice mode |

## What Codex CAN Do

| Capability | How |
|------------|-----|
| Read Obsidian vault files | Direct filesystem read — `cat $OBSIDIAN_VAULT/path/file.md` |
| 1Password credentials | `op item get "<item>" --fields label=<field>` |
| Draft text content | Write Hebrew messages, outreach emails, schedules as plain files |
| File-based schedule | Write schedule to `~/.golems-zikaron/coach/schedule-YYYY-MM-DD.md` |

## Workaround Pattern (if Codex must be used)

```bash
# 1. Export BrainLayer context to file BEFORE spawning Codex (from Claude session)
brain_search("coach <topic>") → save results to /tmp/coach-context.md

# 2. Pass context file to Codex prompt
codex --model gpt-5.4 --approval-mode full-auto "$(cat /tmp/coach-context.md)\n\nTask: ..."

# 3. After Codex finishes, have Claude store outcomes
brain_store(content: "Coach outcome: ...", tags: ["coach"], importance: 7)
```

## Recommendation

**Use Claude for all coach tasks.** Codex is suitable only for isolated text generation (drafting a message, writing a schedule file) where historical context is not needed — and even then, Claude is preferred because it can verify against BrainLayer for correction history.
