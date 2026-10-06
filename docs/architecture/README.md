# Architecture Decisions

This folder is the **canonical record** of architectural decisions made in the golems monorepo.

## Convention

When making architecture decisions:

1. **Create a `.md` file** in this folder with a descriptive name (e.g., `scheduler-isolation.md`)
2. **Include**: context, options considered, decision, rationale
3. **Date it**: Include the date the decision was made
4. **Keep it factual**: These are reference docs, not opinions

## Auto-Indexing

Files in this folder get indexed into BrainLayer for semantic search:

```bash
# Search past decisions
brainlayer search "scheduler isolation" --project golems

# Or via MCP
mcp__brainlayer__brain_search(query="scheduler isolation", project="<BRAINLAYER_PROJECT_SLUG>")
```

## Current Documents

| File | Topic | Date |
|------|-------|------|
| `decisions.md` | Componentization reference (golem taxonomy, deployment, state, launchd; delivery route retired 2026-10-01) | 2026-02-11 |
