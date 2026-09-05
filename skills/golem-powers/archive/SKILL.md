---
name: archive
description: "Plan sprint transitions, archive work, reset PRD. Triggers: archive, cleanup, sprint transition, reset PRD."
---

# Archive PRD Stories

> Archive completed stories to `docs.local/prd-archive/` with full history preservation. Optionally reset the working PRD for a fresh start.

## Available Scripts

Run these directly - standalone, no ralph.zsh dependency:

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/archive-snapshot.sh` | Create archive snapshot | `bash ~/.claude/skills/archive/scripts/archive-snapshot.sh` |
| `scripts/cleanup-completed.sh` | Archive + remove completed | `bash ~/.claude/skills/archive/scripts/cleanup-completed.sh` |

---

## Quick Actions

| What you want to do | Workflow |
|---------------------|----------|
| Archive current PRD state (snapshot) | [workflows/archive-snapshot.md](workflows/archive-snapshot.md) |
| Remove completed stories (cleanup) | [workflows/cleanup-completed.md](workflows/cleanup-completed.md) |

---

## What Gets Archived

Each archive creates a timestamped directory:

```
docs.local/prd-archive/20260123-153000/
├── index.json           # PRD index at time of archive
├── stories/             # All story files (completed + pending)
│   ├── US-001.json
│   ├── US-002.json
│   └── ...
└── progress.txt         # Ralph progress log
```

---

## Cleanup Behavior

When cleanup is triggered (via `--clean` or confirming prompt):

1. **Completed stories deleted** - All `*.json` files where `passes=true`
2. **Index reset** - Stats reset, pending array rebuilt from remaining stories
3. **Progress cleared** - `progress.txt` replaced with fresh start header

**History is always preserved** - The archive contains full state before cleanup.

---

## Safety Notes

1. **Always archives first** - Cleanup only happens after successful archive
2. **Blocked stories preserved** - Stories in blocked array are kept
3. **Pending stories preserved** - Only completed (passes=true) stories removed
4. **Reversible** - Full state available in `docs.local/prd-archive/`
