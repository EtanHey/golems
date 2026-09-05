---
name: catchup
description: "Use when returning to work after any break — auto-detects depth. Short break (hours): reads only uncommitted changes. Long break (48h+) or context overflow: reads all branch changes vs main. Covers catchup, context recovery, refresh, rebuild understanding. NOT for: mid-task exploration (use Read/Grep directly)."
---

# Skill: Catchup (Context Recovery)

> Auto-detects break length and adjusts depth. Short break = uncommitted changes only. Long break = full branch diff vs main.

## When to Use

- Returning after ANY break (hours or days)
- Context window overflow — need to rebuild understanding
- Before committing — review what's staged
- Reviewing what's been done on a feature branch

## Auto-Detect Mode

**Check both signals to pick the right mode:**

```bash
# 1. Check uncommitted changes
git status --short

# 2. Check branch commit count
git log --oneline main...HEAD 2>/dev/null | wc -l
```

| Uncommitted changes? | Branch commits? | Mode |
|---------------------|-----------------|------|
| Yes | Few (0-3) | **Quick** — read uncommitted only |
| No | Many (4+) | **Full** — read all branch changes |
| Yes | Many (4+) | **Full** — read everything |
| No | None | **Nothing to catch up on** |

User can override: `/catchup quick` or `/catchup full`

---

## Quick Mode (short break, uncommitted changes)

### Step 1: Get Status

```bash
git status --short
```

Status codes:
- `M ` — Modified (staged)
- ` M` — Modified (unstaged)
- `MM` — Modified (both)
- `A ` — Added (staged)
- `??` — Untracked

### Step 2: Read Modified Files

Read only files with `M` status. Skip untracked (`??`) unless relevant.

### Step 3: Quick Summary

- Files currently being edited
- What changes are in progress
- Ready to continue or need clarification

---

## Full Mode (long break, full branch context)

### Step 1: Get Changed Files

```bash
git diff --name-only main...HEAD
```

### Step 2: Read All Changed Files

Read in dependency order:
1. Schema/database files (`schema.ts`, `convex/`, `prisma/`)
2. Config files (`package.json`, `tsconfig.json`, `.env.example`)
3. Server/API files (`actions/`, `api/`, `server/`)
4. Components/UI files (`components/`, `app/`)
5. Tests (`tests/`, `*.test.ts`)

### Step 3: Full Summary

- What feature/fix is being worked on
- Current state of implementation
- What appears to be left to do

---

## Tips

- If full mode shows 50+ files, start with quick mode first
- Check `git log main...HEAD --oneline` for commit history context
- Look for TODO/FIXME comments to understand remaining work
- Combine with `git diff` to see actual line changes
