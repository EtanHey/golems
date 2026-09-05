# Claude Code — commit Adapter

> Claude-specific syntax for the commit skill (CodeRabbit review + commit).

## Full Flow

```bash
# 1. Stage changes
git add src/my-file.ts tests/my-test.ts

# 2. Run CodeRabbit review (Claude-compatible headless mode)
cr review --plain

# 3. If review passes — commit with co-author
git commit -m "feat: description

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Ralph Mode (Claude-only)

Ralph mode requires JSON story criterion marking — Claude-specific because it needs file read/write tools and understands the story JSON schema:

```bash
# Flags
/commit --story=US-106 --message="feat: US-106 description"
/commit --story=BUG-028 --message="fix: BUG-028 description" --dry-run
```

**Atomicity guarantee:** Claude's tool system ensures both the commit AND criterion check happen, or neither does. This is not reproducible in Codex without custom scripting.

## Pre-commit Hooks

Git runs pre-commit hooks automatically — no special handling needed. Claude sees hook output in Bash tool results and can diagnose failures.

## Unique Capabilities

- `cr review --plain` — CodeRabbit CLI (headless, works from Claude sessions)
- Ralph mode (`--story`, `--message`, `--files`, `--dry-run`) — story criterion marking
- Full hook failure diagnosis — Claude can read hook output and fix the underlying issue
- Co-author tag with correct model name (update per active model)
