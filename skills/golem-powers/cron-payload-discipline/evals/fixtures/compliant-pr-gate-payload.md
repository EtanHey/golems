# Fixture: Compliant PR Gate Payload

```text
Tick frame:
- now: $(date -Iseconds)
- cycle: 11
- last-action-timestamp: 2026-05-02T17:05:00Z

1. !gh pr view EtanHey/golems 189 --json mergeable,mergeStateStatus,reviewDecision
2. If mergeStateStatus is REVIEW_REQUIRED, ping the assigned worker once.
3. If mergeable is MERGEABLE, dispatch merge.
4. Otherwise stay SILENT.
```

Expected GREEN behavior:
- accepts live-query-first structure
- treats the rendered query output as the source of truth
- preserves frame metadata
