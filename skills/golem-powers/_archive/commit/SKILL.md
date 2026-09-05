---
name: commit
description: "Use when ready to commit changes. Runs CodeRabbit review first, then commits if review passes. Supports Ralph mode for atomic commit + criterion marking. Covers commit, ralph commit, atomic commit. NOT for: pushing or creating PRs (use pr-loop)."
---

# Commit with Code Review

Runs CodeRabbit review on staged changes, then commits if approved.

## Flow

1. Check for staged changes
2. Run CodeRabbit review (`cr review --plain` for headless/Claude compatibility)
3. Show review results
4. If review passes → prompt for commit message → commit
5. If review fails → show issues → ask user if they want to proceed anyway

## Usage

```bash
# Stage your changes first
git add <files>

# Standard commit
/commit

# Ralph mode — atomic commit + mark story criterion
/commit --story=US-106 --message="feat: US-106 description"
```

## What This Skill Does

When invoked, Claude will:

1. **Check staged changes**: Run `git diff --staged --stat` to show what's staged
2. **Run CodeRabbit**: Execute `cr review --plain` (headless mode, works from Claude)
3. **Evaluate results**:
   - If CR passes (no critical issues): proceed to commit
   - If CR fails: show issues and ask user for decision
4. **Commit**: Generate commit message based on changes, commit with co-author

## Ralph Mode (Story Commits)

When `--story` is provided, this skill does atomic commit + criterion marking:

1. **Stages files** (specified or auto-detected)
2. **Commits** (pre-commit hook runs all tests)
3. **If commit succeeds** → marks the commit criterion as checked in story JSON
4. **If commit fails** → neither happens, reports failure

### Ralph Mode Flags

| Flag | Description |
|------|-------------|
| `--story=ID` | Story ID (e.g., US-106, BUG-028) — triggers Ralph mode |
| `--message=MSG` | Commit message (required in Ralph mode) |
| `--files=PATHS` | Files to stage (default: prd-json/ + modified files) |
| `--dry-run` | Show what would happen without doing it |

### Why Ralph Mode Exists

- **Atomic**: Either both happen (commit + check) or neither
- **No double-testing**: Uses pre-commit hook, doesn't run tests twice
- **Clean failure**: If tests fail, criterion stays unchecked for retry

## Requirements

- `cr` CLI installed (CodeRabbit)
- Changes staged with `git add`

## After Committing

Committing is ONE step in the full workflow. After commit:
1. **Push** → `git push -u origin <branch>`
2. **PR + Review + Merge** → `/pr-loop` (the full loop)

**Do NOT stop at commit.** The mission is MERGED, not committed.
