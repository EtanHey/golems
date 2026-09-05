---
name: setup
description: Set up verification folder with instructions.md and tracker.md templates
---

# Setup Verification

> Create the verification folder structure and templates before running critique waves.

## Quick Start

Use the init script:
```bash
bash ~/.claude/commands/critique-waves/scripts/init-tracker.sh <branch-name> [goal]
```

Example:
```bash
bash ~/.claude/commands/critique-waves/scripts/init-tracker.sh feature-auth 20
```

---

## Manual Setup

### Step 1: Create Verification Folder

```bash
mkdir -p docs.local/<BRANCH-NAME>
```

Replace `<BRANCH-NAME>` with your current git branch or ticket ID.

---

### Step 2: Create instructions.md

Create `docs.local/<BRANCH-NAME>/instructions.md` with this structure:

```markdown
# Verification Instructions

## Context
[Describe what this PR/change does. What problem does it solve?]

## Files to Verify
| # | File | Purpose |
|---|------|---------|
| 1 | `path/to/file1.ts` | [What this file does] |
| 2 | `path/to/file2.sql` | [What this file does] |

## FORBIDDEN Patterns (FAIL if found)
These patterns must NOT exist in the code:

- [ ] `console.log` - Remove debug statements
- [ ] `// TODO` - Incomplete work
- [ ] `any` type - Avoid untyped code
- [ ] `SELECT *` - Be explicit with columns

## REQUIRED Patterns (FAIL if missing)
These patterns MUST exist:

- [ ] Error handling - Try/catch blocks
- [ ] Type annotations - All functions typed
- [ ] Unit tests - Test file exists
- [ ] Documentation - JSDoc comments

## Output Format for Agents
```
# Round N - Agent X
**VERDICT:** PASS or FAIL
**Checked:** [list what was verified]
**Issues:** [any problems found, or "None"]
```
```

---

### Step 3: Create tracker.md

Create `docs.local/<BRANCH-NAME>/tracker.md` with this structure:

```markdown
# <TICKET> Verification Tracker

## Goal: 20 Consecutive Passes
(Adjust goal based on confidence needed)

## Current Status
- **Consecutive Passes:** 0
- **Total Rounds:** 0
- **Last Updated:** [timestamp]

## Files Under Verification
| # | File | Purpose |
|---|------|---------|
| 1 | `path/to/file1.ts` | Description |
| 2 | `path/to/file2.sql` | Description |

## Verification Rules

### FORBIDDEN Patterns (FAIL if found):
- Pattern 1
- Pattern 2

### REQUIRED Patterns (FAIL if missing):
- Pattern 1
- Pattern 2

## Wave Log
| Round | Agent 1 | Agent 2 | Agent 3 | Result | Notes |
|-------|---------|---------|---------|--------|-------|
| 1     | -       | -       | -       | -      | -     |
```

---

## Checklist

Before proceeding to [run-wave.md](run-wave.md):

- [ ] Created `docs.local/<BRANCH>/` folder
- [ ] Created `instructions.md` with:
  - [ ] Context section
  - [ ] Files to verify (full paths)
  - [ ] FORBIDDEN patterns
  - [ ] REQUIRED patterns
  - [ ] Output format for agents
- [ ] Created `tracker.md` with:
  - [ ] Goal (consecutive passes needed)
  - [ ] Files under verification
  - [ ] Empty wave log table

---

## Tips

1. **Be specific with patterns** - Vague rules lead to inconsistent results
2. **Use full file paths** - Agents need exact locations
3. **Start with fewer files** - Add more as verification passes
4. **Set realistic goals** - 6-12 passes for low-risk, 15-20 for high-risk
5. **Document context** - Agents work better with understanding

---

## Next Step

Once setup is complete, proceed to [workflows/run-wave.md](run-wave.md) to launch your first wave of agents.
