---
name: iteration
description: Handle failures, reset counters, and continue iterating until consensus goal is reached
---

# Iteration

> Handle wave failures, fix issues, and continue iterating until the consensus goal is reached.

## When a Wave Fails

If ANY agent returns FAIL, the wave fails. Here's what to do:

### Step 1: Identify the Issues

Read the failing agent's output file:
```
docs.local/<BRANCH>/round-N-agent-X.md
```

Look for:
- Which file(s) failed
- Which pattern was violated (FORBIDDEN found or REQUIRED missing)
- Specific location (file, line number if provided)

### Step 2: Reset Consecutive Passes

Update `tracker.md`:
```markdown
## Current Status
- **Consecutive Passes:** 0  <-- RESET TO ZERO
- **Total Rounds:** N+1
- **Last Updated:** [timestamp]
```

### Step 3: Fix the Issues

Address each issue found:

| Issue Type | Action |
|------------|--------|
| FORBIDDEN pattern found | Remove or refactor the code |
| REQUIRED pattern missing | Add the required code/pattern |
| Multiple issues | Fix all before next wave |

### Step 4: Run Another Wave

Return to [workflows/run-wave.md](run-wave.md) and launch the next wave.

---

## When All Agents Pass

If all 3 agents return PASS:

### Step 1: Increment Consecutive Passes

Update `tracker.md`:
```markdown
## Current Status
- **Consecutive Passes:** N + 3  <-- Add 3 (one per agent)
- **Total Rounds:** M + 1
- **Last Updated:** [timestamp]
```

### Step 2: Check if Goal Reached

| Consecutive Passes | Action |
|--------------------|--------|
| < Goal | Continue - run another wave |
| >= Goal | SUCCESS! Verification complete |

---

## Maximum Rounds Safeguard

**If Total Rounds reaches 10 without achieving goal:**

1. **STOP** - Do not continue automatically
2. **Escalate to user** - Something may be fundamentally wrong
3. **Review patterns** - Are FORBIDDEN/REQUIRED patterns correct?
4. **Consider scope** - Maybe verification scope is too broad?

```markdown
## Escalation Notice

After 10 rounds, consensus goal of 20 not reached.

**Analysis:**
- Most common failure: [pattern]
- Most problematic file: [path]
- Suggested action: [recommendation]

Awaiting user guidance before continuing.
```

---

## Iteration Flow

```
┌─────────────────────────────────┐
│         Wave Completed          │
└───────────────┬─────────────────┘
                │
        ┌───────▼───────┐
        │  Any FAIL?    │
        └───────┬───────┘
                │
     Yes ───────┼─────── No
        │               │
┌───────▼───────┐ ┌─────▼─────┐
│ Reset passes  │ │ Add +3 to │
│ to 0          │ │ passes    │
└───────┬───────┘ └─────┬─────┘
        │               │
┌───────▼───────┐ ┌─────▼─────┐
│ Fix issues    │ │ Goal met? │
│ found         │ └─────┬─────┘
└───────┬───────┘       │
        │        Yes ───┼─── No
        │          │    │
        │    ┌─────▼────┐│
        │    │  DONE!   ││
        │    │ Success  ││
        │    └──────────┘│
        │                │
        └────────┬───────┘
                 │
         ┌───────▼───────┐
         │ Round >= 10?  │
         └───────┬───────┘
                 │
      Yes ───────┼─────── No
          │             │
    ┌─────▼─────┐ ┌─────▼─────┐
    │ ESCALATE  │ │ Run next  │
    │ to user   │ │ wave      │
    └───────────┘ └───────────┘
```

---

## Example Iteration Sequence

```
Wave 1: Agent 2 FAIL (found console.log)
  - Consecutive: 0
  - Action: Remove console.log from auth.ts:45

Wave 2: All PASS
  - Consecutive: 3

Wave 3: All PASS
  - Consecutive: 6

Wave 4: Agent 1 FAIL (missing type annotation)
  - Consecutive: 0 (RESET!)
  - Action: Add return type to fetchUser()

Wave 5: All PASS
  - Consecutive: 3

... (continuing waves)

Wave 10: All PASS
  - Consecutive: 21
  - Goal: 20
  - Result: SUCCESS! Goal exceeded.
```

---

## Common Failure Patterns

| Failure Type | Typical Cause | Fix |
|--------------|---------------|-----|
| Inconsistent results | Agents interpret patterns differently | Make patterns more specific |
| Always fails on same file | Fundamental issue in that file | Focus fix effort there |
| Passes then fails randomly | Flaky pattern definition | Tighten pattern criteria |
| Never reaches goal | Goal too high or scope too broad | Reduce goal or narrow scope |

---

## Tips

1. **Fix root cause, not symptoms** - A superficial fix will fail next wave
2. **One issue at a time** - Fix clearly, don't introduce new problems
3. **Document fixes** - Note what was changed in tracker.md
4. **Adjust patterns if needed** - Sometimes the pattern needs refinement
5. **Don't game the system** - If code needs work, fix it properly
