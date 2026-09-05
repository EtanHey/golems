<!-- IDENTITY: golems monorepo, EtanHey, autonomous AI agent ecosystem -->
# Golems Monorepo

> Bun workspace of reusable agent packages, CLIs, and evaluated workflow skills.

## Packages

The current workspace inventory and package purposes live in `README.md`.
Always read the package-specific `CLAUDE.md` before changing a package.

## Key Relationships

- **ClaudeGolem** registers Composers from Jobs + Recruiter for Telegram commands
- **CoachGolem** reads getStatus() from Jobs, Recruiter, Teller (read-only)
- **Services** (briefing) imports from Coach for daily plan generation
- **Cloud Worker** remains a local/successor-host runnable scheduler; Railway service was deleted on 2026-07-05
- **All packages** depend on Shared for Supabase, LLM, state, notifications

## Development

```bash
bun install              # Install all workspace deps
bun test                 # Run all tests
```

CI runs on PRs into any base branch, so a stacked PR gets the full suite.

## Worktree-Isolated Agents

Agents declaring `isolation: worktree` in `.claude/agents/*.md` get their own git
worktree, for parallel work without file conflicts.

## Communication Style

- **Formality:** 2/10 — Very casual
- **Length:** Brief, direct
- **Tone:** Friendly, sometimes playful

See `packages/claude/SOUL.md` for bot persona.

## Never write durable content to /tmp

Durable content goes in the repo or its `docs.local/` — never `/tmp`,
`/private/tmp`, `/var/folders`, or `$TMPDIR`, which are wiped on reboot and
invisible to the rest of the fleet. Worktrees go in `<repo>/.worktrees/<name>`.
Genuinely ephemeral? `WEAVE_ALLOW_TMP=1 <command>` — allowed and logged.
Claude and Cursor panes are held to this by the `tmp-block` PreToolUse hook;
**Codex panes are not wired**, so in a Codex lane it is a rule you follow, not a
rail that catches you. Full contract, and why Codex is unwired:
`skills/golem-powers/tmp-block/SKILL.md`.
