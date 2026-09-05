Tick frame:
- now: 2026-05-02T17:10:00Z
- cycle: 1..12
- last-genuine-dispatch-time: 2026-05-02T16:42:00Z

Hardcoded state:
- PR #393 is BLOCKED REVIEW_REQUIRED
- no new dispatch needed
- keep monitoring

Observed failure shape:
- no `!gh pr view`
- no collab freshness query
- no queue-decrement verification
- same stale frame repeated twelve times
