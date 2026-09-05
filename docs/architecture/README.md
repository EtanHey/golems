# Architecture Decisions

This folder is the **canonical record** of architectural decisions made in the golems monorepo.

## Convention

When making architecture decisions:

1. **Create a `.md` file** in this folder with a descriptive name (e.g., `telegram-topic-simplification.md`)
2. **Include**: context, options considered, decision, rationale
3. **Date it**: Include the date the decision was made
4. **Keep it factual**: These are reference docs, not opinions

## Auto-Indexing

Files in this folder get indexed into BrainLayer for semantic search:

```bash
# Search past decisions
brainlayer search "telegram routing" --project golems

# Or via MCP
mcp__brainlayer__brainlayer_search(query="telegram routing", project="<BRAINLAYER_PROJECT_SLUG>")
```

## Current Documents

| File | Topic | Date |
|------|-------|------|
| `decisions.md` | Componentization reference (golem taxonomy, deployment, state, Telegram, launchd) | 2026-02-11 |
| `contexts-to-rules-migration.md` | Migration from @contexts/ to .claude/rules/ | 2026-02-11 |

## Interview Topics

Architecture decisions that are also useful for interview prep go in `packages/recruiter/docs/topics/` with a cross-reference here.

- RAG vs Fine-Tuning: `packages/recruiter/docs/topics/rag-vs-fine-tuning.md`
