---
name: cleanup-completed
description: Remove completed stories and reset PRD for fresh start
---

# Cleanup Completed Stories Workflow

Archives current state then removes completed stories for a fresh start.

## When to Use

- Sprint completed, ready for new stories
- Too many completed stories cluttering the PRD
- Starting a new phase of development

## Steps

### Option A: Interactive Cleanup

```bash
source ~/.config/golems/ralph.zsh && ralph-archive
```

1. Creates archive snapshot
2. Prompts: "Reset PRD for fresh start?"
3. If confirmed, removes completed stories

### Option B: Auto Cleanup

```bash
source ~/.config/golems/ralph.zsh && ralph-archive --clean
```

Skips confirmation, automatically cleans up after archiving.

---

## What Gets Removed

Only stories where `passes: true` in their JSON file:

- `US-*` completed user stories
- `BUG-*` fixed bugs
- `V-*` passed verifications
- `TEST-*` completed tests

## What Gets Preserved

- **Pending stories** - Remaining work
- **Blocked stories** - Waiting on dependencies
- **Archive** - Full history in `docs.local/prd-archive/`

---

## Index.json Reset

After cleanup:

```json
{
  "stats": {
    "total": <remaining count>,
    "completed": 0,
    "pending": <pending count>,
    "blocked": <blocked count>
  },
  "storyOrder": [<remaining stories>],
  "pending": [<remaining pending>],
  "blocked": [<unchanged>],
  "nextStory": "<first pending>"
}
```

---

## Progress.txt Reset

After cleanup, `progress.txt` is replaced with:

```
# Ralph Progress - Fresh Start
Started: <current date>

(Previous progress archived to docs.local/prd-archive/<timestamp>/)
```

---

## Recovery

If you need to restore:

```bash
# Find latest archive
ls -t docs.local/prd-archive/

# Restore stories
cp docs.local/prd-archive/<timestamp>/stories/*.json prd-json/stories/
cp docs.local/prd-archive/<timestamp>/index.json prd-json/
cp docs.local/prd-archive/<timestamp>/progress.txt .
```

---

## Verification

After cleanup, run:

```bash
ralph-status
```

Should show:
- Completed: 0
- Pending: (remaining stories)
- Next story: (first pending)
