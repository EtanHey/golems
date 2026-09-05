---
name: run-wave
description: Launch a wave of parallel verification agents and collect results
---

# Run a Wave

> Launch 3 parallel agents to verify files and collect their results.

## Prerequisites

- Completed setup: `docs.local/<BRANCH>/instructions.md` and `tracker.md` exist
- Know the current wave number (check tracker.md)

---

## Launch Wave

### Step 1: Read Current State

```
Read docs.local/<BRANCH>/tracker.md
- Note current wave number (Total Rounds + 1)
- Note consecutive pass count
```

### Step 2: Launch 3 Agents in Parallel

Use the Task tool with `subagent_type: "general-purpose"` for each agent.

**Agent Prompt Template:**

```
VERIFICATION AGENT - Wave N, Agent X

Read: docs.local/<BRANCH>/instructions.md

VERIFY these files:
[List file paths from instructions.md]

For each file:
1. Check for FORBIDDEN patterns (FAIL if ANY found)
2. Check for REQUIRED patterns (FAIL if ANY missing)

Write your findings to: docs.local/<BRANCH>/round-N-agent-X.md

Format:
# Round N - Agent X
**VERDICT:** PASS or FAIL
**Files Checked:**
- file1.ts: PASS/FAIL (details)
- file2.sql: PASS/FAIL (details)
**Issues Found:**
- [List specific issues, or "None"]
```

**Example - Launching Wave 1:**

```
// Launch all 3 agents in a SINGLE message with multiple Task tool calls:

Task 1: "Verification Agent - Wave 1, Agent 1"
Task 2: "Verification Agent - Wave 1, Agent 2"
Task 3: "Verification Agent - Wave 1, Agent 3"
```

---

## Collect Results

### Step 3: Wait for All Agents

All 3 agents must complete before proceeding. Check for their output files:

```
docs.local/<BRANCH>/round-N-agent-1.md
docs.local/<BRANCH>/round-N-agent-2.md
docs.local/<BRANCH>/round-N-agent-3.md
```

### Step 4: Tally Results

| Agent | Verdict | Issues |
|-------|---------|--------|
| 1     | ?       | ?      |
| 2     | ?       | ?      |
| 3     | ?       | ?      |

**Wave Result:**
- ALL PASS = Wave passes
- ANY FAIL = Wave fails

---

## Update Tracker

### Step 5: Update tracker.md

Add a row to the Wave Log table:

```markdown
| Round | Agent 1 | Agent 2 | Agent 3 | Result | Notes |
|-------|---------|---------|---------|--------|-------|
| N     | PASS    | FAIL    | PASS    | 2/3    | Agent 2 found forbidden pattern |
```

Update status section:
- **Total Rounds:** increment by 1
- **Consecutive Passes:**
  - If ALL PASS: add 3 to current count
  - If ANY FAIL: reset to 0
- **Last Updated:** current timestamp

---

## Example Wave Execution

```
=== Wave 1 ===

Launching 3 agents in parallel...

Agent 1 completed: PASS
Agent 2 completed: FAIL (found console.log in auth.ts line 45)
Agent 3 completed: PASS

Wave Result: 2/3 PASS

Updating tracker.md:
- Total Rounds: 1
- Consecutive Passes: 0 (reset due to failure)

Issue to fix: Remove console.log from auth.ts line 45

=== After Fix ===

Proceed to Wave 2...
```

---

## Next Steps

| Outcome | Action |
|---------|--------|
| All 3 PASS | Check if goal reached. If yes, done! If not, run another wave. |
| Any FAIL | Go to [workflows/iteration.md](iteration.md) to handle failures |
| Goal reached | Verification complete! Document final results. |

---

## Tips

1. **Always use parallel Task calls** - Send all 3 in ONE message
2. **Number waves sequentially** - Wave 1, 2, 3... don't skip
3. **Log everything** - Each agent writes to its own file
4. **Be patient** - Agents need time to read and verify
5. **Check output files exist** - Don't assume success without evidence
