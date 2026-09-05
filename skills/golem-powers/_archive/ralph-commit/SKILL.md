---
name: ralph-commit
description: "Use when reaching a \"Commit:\" criterion in Ralph stories. Atomically commits and marks criterion checked. Covers ralph commit, atomic commit, commit criterion. NOT for: regular git commits (use git directly), commits outside Ralph workflow."
---

# Skill: Ralph Commit (Atomic Commit + Check)

> Use when hitting a "Commit: ..." acceptance criterion in a Ralph story. Commits atomically with criterion marking - if commit fails (tests fail), criterion stays unchecked.

## Usage

```bash
/ralph-commit --story=US-106 --message="feat: US-106 description"
```

## What It Does

1. **Stages files** (specified or auto-detected)
2. **Commits** (pre-commit hook runs all tests)
3. **If commit succeeds** → marks the commit criterion as checked in story JSON
4. **If commit fails** → neither happens, reports failure

## Flags

| Flag | Description |
|------|-------------|
| `--story=ID` | Story ID (e.g., US-106, BUG-028) - required |
| `--message=MSG` | Commit message - required |
| `--files=PATHS` | Files to stage (default: prd-json/ + modified files) |
| `--dry-run` | Show what would happen without doing it |

## Example

```bash
# After completing US-106 work:
/ralph-commit --story=US-106 --message="feat: US-106 UI foundation"

# Success output:
# ✓ Committed (all tests passed)
# ✓ Marked commit criterion as checked in US-106.json

# Failure output:
# ✗ Commit failed (tests failed in pre-commit hook)
# → Fix tests, then retry
# → Commit criterion NOT checked
```

## Why Use This

- **Atomic**: Either both happen (commit + check) or neither
- **No double-testing**: Uses pre-commit hook, doesn't run tests twice
- **Clean failure**: If tests fail, criterion stays unchecked for retry
