Tick frame:
- now: $(date -Iseconds)
- cycle: 4
- last-genuine-dispatch-time: 2026-05-02T17:00:00Z
- consecutive-no-change-ticks: 3
- consecutive-no-push-ticks: 3
- park-threshold: 8

1. !gh pr view EtanHey/golems 393 --json mergeable,mergeStateStatus,reviewDecision
2. !find $ORCHESTRATOR_REPO/collab -newer 2026-05-02T17:00:00Z
3. If the PR is mergeable, dispatch admin-merge and update `last-genuine-dispatch-time`.
4. If a worker claims completion without a verified side-effect, run verify-and-decrement.
5. If no material delta exists and the counter reaches threshold, escalate-park.
