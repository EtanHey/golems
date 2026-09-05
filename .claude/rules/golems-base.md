# Golems Base Rules

## AIDEV-NOTE Guidelines

Use `AIDEV-NOTE:`, `AIDEV-TODO:`, or `AIDEV-QUESTION:` (all-caps prefix) for AI-facing comments.
- Grep for existing `AIDEV-*` anchors before scanning files
- Update anchors when modifying associated code
- Never remove AIDEV-NOTEs without explicit human instruction

## TypeScript Safety

- **NEVER** use non-null assertions (`!`) without validation — always check + throw
- Validate external data (env vars, API responses, user input)

## Formatting

- **NEVER format the whole project** unless explicitly asked
- Only format code you are actively modifying

## Architecture Decisions

Document in `docs/architecture/` as Markdown. Search past decisions via BrainLayer: `brain_search(query="topic")`.
