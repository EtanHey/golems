# Migration: @contexts/ to .claude/rules/

**Date:** 2026-02-11
**Issue:** #90
**Status:** Complete

## Context

The `@contexts/` import pattern (`@contexts/base.md` in CLAUDE.md files) was unreliable after Opus 4.6 context compaction. Referenced files were silently dropped, causing Claude sessions to lose critical rules mid-conversation.

Reddit confirmed this was a known issue with `@import`/`@contexts` syntax after compaction.

## Options Considered

1. **Keep @contexts/ and hope for a fix** — Rejected. Unreliable tooling blocks autonomous operation.
2. **Inline everything into CLAUDE.md** — Rejected. Makes CLAUDE.md huge and hard to maintain.
3. **Migrate to `.claude/rules/`** — Chosen. Auto-loaded by Claude Code, survives compaction, supports path targeting via YAML frontmatter.

## Decision

Two-tier system:

1. **`.claude/rules/`** — Auto-loaded rules per-repo. Small, actionable, deduplicated against `~/.claude/CLAUDE.md`.
2. **`rules-library/`** (renamed from `contexts/`) — Exportable master collection. Reference docs, tech contexts, workflow guides. Symlink relevant files into other projects' `.claude/rules/`.

### What Moved to Auto-Loaded Rules

| Source | Rule File | Scope |
|--------|-----------|-------|
| `rules-library/base.md` | `.claude/rules/golems-base.md` | Always loaded (golems-specific rules only) |
| `rules-library/workflow/ralph.md` | `.claude/rules/ralph-workflow.md` | `packages/ralph/**` only |
| `rules-library/tech/ink.md` | `.claude/rules/tech-ink.md` | `**/ralph-ui/**` only |

### What Stays in rules-library/ (Reference)

| File | Purpose |
|------|---------|
| `rules-library/workflow/ralph.md` | Full Ralph workflow documentation |
| `rules-library/workflow/interactive.md` | Interactive session reference |
| `rules-library/golem-system.md` | Philosophy and architecture overview |
| `rules-library/golem-ecosystem.md` | Ecosystem reference (needs updating) |
| `rules-library/tech/*.md` | Tech contexts for export to other projects |
| `rules-library/claude-chat/` | Claude.ai project files |
| `rules-library/skill-*.md` | Auto-generated skill indices |

### Key Principles

1. **Deduplicate**: If `~/.claude/CLAUDE.md` already has the rule, don't repeat in `.claude/rules/`
2. **Path-target**: Use YAML `globs:` frontmatter so rules only load where relevant
3. **Keep rules concise**: Auto-loaded files add to every session's context — keep them small
4. **Export via symlinks**: Copy/symlink `rules-library/` files into other projects' `.claude/rules/`

## Rationale

- `.claude/rules/` is Claude Code's recommended pattern (2026)
- Auto-loaded = survives compaction, no import syntax needed
- YAML frontmatter enables package-specific rules without bloating all sessions
- `rules-library/` is the exportable master collection for all projects
