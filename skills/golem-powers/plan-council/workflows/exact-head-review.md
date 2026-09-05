# Exact-Head Review Loop

## Before each round

Publish this contract before dispatch:

```text
HEAD: <full SHA>
AXIS: <one explicit defect axis>
METHOD: <adversarial mutation strategy>
SURFACE: <MACHINERY-CHANGED|TESTS-DOCS-ONLY>
STALE-ONLY COUNTER: <current count>
STOP-LINE: <published same-axis, adversarial-method, unchanged-machinery threshold>
ALLOWED VERDICTS: ACCEPT / ITERATE / MUST_FIX
```

Changing axis resets the stale-only counter to zero. A confirmatory happy-path round never increments
it: the method must attempt to construct an input that defeats the reviewed rules. Any head that
adds or changes executable machinery also resets the counter before review; only tests/docs-only
deltas preserve a prior stale-only count.

## Reviewer output

```text
VERDICT: <ACCEPT|ITERATE|MUST_FIX> at exact head <full SHA>
AXIS: <axis actually reviewed>
METHOD: <adversarial mutations actually attempted>
SURFACE: <machinery changed since prior reviewed head, or tests/docs only>
SURVIVING FINDINGS:
1. <falsifiable finding or NONE>
GATE ITEMS: <enumerated items for MUST_FIX, otherwise NONE>
STALE-ONLY: <YES|NO>
```

MUST_FIX carries enumerated gates. ITERATE carries actionable findings. ACCEPT means no surviving
gate on that exact head; it does not bless a future commit.

## Head movement law

1. Compare the current local and remote head with the reviewed SHA before merge.
2. If they differ for any reason, mark the verdict STALE, publish the new exact head, and re-review.
3. Merge only when the head being merged is the head named in ACCEPT.
4. A stale-only round increments the stop counter only when its axis equals the prior round's axis
   and its method adversarially attempted to defeat the rules.
5. Reset the counter to zero before reviewing any head whose delta adds or changes executable
   machinery. Only tests/docs-only head movement preserves the previous count.
6. A confirmatory happy-path re-run never increments the counter, even when green.
7. Stop only when the pre-published axis-, method-, and surface-qualified stop-line is met and
   ordinary PR/CI gates are green.
