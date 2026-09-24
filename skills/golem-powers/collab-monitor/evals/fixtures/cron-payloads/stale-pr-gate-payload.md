# Fixture: Stale PR Gate Payload

```text
Tick frame:
- now: 2026-05-02T17:10:00Z
- cycle: 14
- last-action-timestamp: 2026-05-02T16:42:00Z

We have 3 PRs at merge gate BLOCKED REVIEW_REQUIRED.
Keep monitoring and stay SILENT unless one unblocks.

1. Read the state above.
2. Check the collab file.
3. If still blocked, say SILENT autonomous.
```

Expected RED failure:
- baseline agent repeats the hardcoded blocked state
- no live query in step 1
- decision tree depends on stale prompt prose
