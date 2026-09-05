---
name: nightshift
description: Check Night Shift status, view recent PRs, or manually trigger a Night Shift run.
---

# Night Shift

Manage the 4am autonomous coding service.

**Arguments**: $ARGUMENTS — action (status | trigger | history)

## Actions

### status (default)
- Current target repo (from `state.json`)
- Last run time
- Pending PRs from recent runs (`nightShiftPRs[]`)
- Next scheduled run

### trigger
Manually start a Night Shift run:
1. Read target from state or use provided repo name
2. Launch: `bun run packages/services/src/night-shift.ts`
3. Monitor for completion
4. Report: PR URL if created, or "no improvements found"

### history
Show last 10 Night Shift runs with:
- Date, target repo
- PR created (yes/no, URL)
- Status (merged, open, closed)

## Schedule

| Day | Repo |
|-----|------|
| Mon, Thu | songscript |
| Tue, Fri | zikaron |
| Wed, Sat, Sun | claude-golem |

Override: Use Telegram `/tonight` command
