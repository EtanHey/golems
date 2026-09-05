# Golems Codebase Statistics

*Generated: 2026-02-08*

## Size Overview

| Metric | Count |
|--------|-------|
| Total tracked files | 1,047 |
| Source files (ts/tsx/js/py/sh) | 401 |
| Test files | 73 |
| Markdown docs | 331 |
| Config files | 48 |

## Lines of Code by Package

| Package | Lines | Purpose |
|---------|-------|---------|
| **autonomous** | 40,188 | Telegram bot, golems, services |
| **ralph** | 24,981 | Autonomous coding loop |
| **zikaron** | 9,819 | Memory layer (Python) |
| **docsite** | 2,137 | Documentation site |
| **admin-ui** | 565 | Admin dashboard |
| **Total** | **77,690** | |

## Files by Type (top 15)

| Extension | Count |
|-----------|-------|
| .md | 331 |
| .ts | 209 |
| .json | 183 |
| .sh | 109 |
| .py | 48 |
| .tsx | 31 |
| .zsh | 16 |
| .plist | 14 |
| .svg | 11 |
| .css | 10 |
| .txt | 8 |
| .yml | 7 |
| .toml | 6 |
| .sql | 5 |
| .js | 4 |

## Largest Source Files (top 20)

| File | Lines | Notes |
|------|-------|-------|
| telegram-bot.ts | 2,398 | Main bot + notification server |
| pty-wrapper.test.ts | 1,013 | Ralph PTY tests |
| scraper.ts | 884 | Job board scraper |
| wizard.ts | 649 | Setup wizard |
| night-shift.ts | 606 | Autonomous 4am improvements |
| prd.test.ts | 570 | Ralph PRD tests |
| session-archiver.ts | 556 | Session cleanup |
| outreach-db.ts | 554 | Recruiter outreach DB |
| ralph-ui/index.tsx | 548 | Ralph TUI entry point |
| stories.ts | 544 | Ralph story runner |
| wizard-state.ts | 540 | Wizard state management |
| mcp-server.ts | 527 | Email MCP server |
| contact-finder.ts | 513 | Recruiter contact finder |
| email-golem/index.ts | 487 | Email triage entry point |
| outreach-db.test.ts | 485 | Outreach DB tests |
| post-generator.ts | 472 | Soltome post generation |
| cursor-helper.ts | 472 | **Potentially dead** |

## TODOs/FIXMEs

| File | Count | Notes |
|------|-------|-------|
| ollama-helper.ts | 3 | Return null handling |
| ollama-sandboxed.ts | 2 | Return null handling |
| scraper.ts | 2 | Rate limiting, caching |
| router.ts | 1 | Score-based routing |
| night-shift.ts | 1 | Part of prompt text |
| bin/golems | 1 | Telegram launchd migration |
| job-golem-integration.test.ts | 1 | Matcher fix |

## Suspected Dead Code

| File | Lines | Status | Reason |
|------|-------|--------|--------|
| gemini-helper.ts | 320 | **DEAD** | No importers; replaced by agent-runner.ts |
| ollama-chat-bot.ts | 388 | **DEAD** | Plist disabled (401 token); script-only entry |
| cursor-helper.ts | 472 | **DEAD** | No importers; replaced by agent-runner.ts |
| helpers-status.ts | 100 | NOT DEAD | Used by `golems helpers` CLI command |

See `dead-duplicate-code.md` for full analysis including duplicates and dead dependencies.

## Stale References

| Pattern | Files Found | Issue |
|---------|------------|-------|
| "moltbook/Moltbook" | 18 files | Renamed to Soltome; references remain |
| "soltome-influencer" | 2 files | Skill deleted/merged into `/content` |

See `forgotten-plans-stale-refs.md` for full analysis including 40 findings across 5 categories.
