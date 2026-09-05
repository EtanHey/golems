# Execute a Plan Phase

> Run through a single phase: branch, implement, audit, PR, review cycle, merge. Works for both sequential phases and parallel phases (with collab).

## Inputs

1. **Plan directory** — path to the plan folder
2. **Phase number** — which phase to execute (or auto-detect next incomplete)

## Steps

### 1. Read Plan State + Collab Check

```
Read <plan-dir>/README.md
Find the first phase that is NOT marked as done
Read that phase's README.md for steps
```

**Collab awareness check:**
1. Does `<plan-dir>/README.md` have an `## Execution Strategy` section?
2. Does any round show "parallel"?
3. Does `<plan-dir>/collab.md` exist?

| Condition | Action |
|-----------|--------|
| No Execution Strategy section | This is a sequential-only plan. Proceed normally. |
| Parallel rounds exist + collab.md exists | You are part of a collab. Read collab.md FIRST. Follow its update gates at every checkpoint below. |
| Parallel rounds exist + NO collab.md | **STOP.** Run scaffold workflow step 6 to create collab.md before proceeding. |

**If running as part of a collab:**
- Update your agent status to `learning` in collab.md
- Run pre-flight checks and report: "Pre-flight: N tests green" in Messages
- Update status to `working` before starting implementation

### 2. Create Branch

```bash
git checkout master && git pull
git checkout -b feature/phase-<N>-<name>
```

### 3. Implement

Follow the phase README steps. For each step:
- Check if research is needed first (use specified CLI helper)
- Implement the code changes
- Write tests for logic-heavy code
- Update findings.md with decisions and learnings

**If collab:** Update collab.md Messages before every commit with a one-line summary.

### 4. Pre-Commit Checks

Run tests:
```bash
bun test   # or npm test
```

### 5. Local CLI Audit (before push!)

Run a CLI agent to audit your changes **before** pushing. This catches issues locally and saves PR review round-trips.

```bash
# Write audit prompt to file
cat > /tmp/phase-audit-prompt.txt << 'EOF'
Audit the files changed in this phase. Look for:
1. Bugs, logic errors, edge cases
2. Security risks (SQL injection, path traversal, etc.)
3. Missing error handling
4. Type safety issues
5. Consistency with surrounding code patterns
Be specific — file paths, line numbers, severity (HIGH/MEDIUM/LOW).
EOF

# Run a Cursor audit via /cmux-agents, or use the repoGolem headless launcher
# from /repogolem for the target repo:
golemsCursor -s -p "$(cat /tmp/phase-audit-prompt.txt)" > /tmp/phase-audit-result.md
```

Review the output. Fix any HIGH/MEDIUM issues. Re-run tests after fixes.

**Why:** Bot reviewers (CodeRabbit, Cursor Bugbot) take 10-20 minutes. Local audit catches the same issues in one pass, reducing fix-push-wait cycles.

### 6. Commit and Push

```bash
git add <files>
git commit -m "<type>(scope): description"
git push -u origin feature/phase-<N>-<name>
```

**If collab:** Update collab.md Messages BEFORE committing. Verify your agent status is current BEFORE pushing.

### 7. Create PR

Use `/create-pr` skill or:
```bash
gh pr create --title "<type>(scope): phase N description" --body "..."
```

**If collab:** Read other agents' Messages in collab.md for cross-references before creating PR.

### 8. Review Cycle

Wait ~20 min for reviewers (CodeRabbit, Cursor Bugbot, DeepSource). Start next phase prep while waiting.

For each comment:
- **Real bug** -> Fix it
- **Style preference** -> Fix if better
- **Over-engineering** -> Skip
- **Out of context** -> Reply explaining

Push fixes, repeat until clean.

### 9. Merge

```bash
gh pr merge <N> --squash
git checkout master && git pull
```

### 10. Update Plan

In `<plan-dir>/README.md`, mark the phase as done:
```
| N | Phase Name | folder | done | PR #XX merged |
```

Update findings.md with final notes.

**If collab:**
1. Update Task Board in collab.md — status → `done`, add PR link
2. Append a timestamped, addressed Messages heading: `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done: PR #XX merged. Next: <what is unblocked>`
3. If ALL your assigned phases are done → status → `signed-off`
4. If this completes a round → orchestrator advances to next round

**If blocked at any step:** update your status, then append `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>`. Task Board changes and unaddressed prose do not wake the tag-scoped collab monitor.

### 11. Continue

**Sequential plan:** Check if there's a next phase. If yes, go back to step 2.

**Collab plan:** Check collab.md:
- Do you have more phases assigned in the current round? → Go to step 2
- Is the current round complete (all agents done)? → Wait for orchestrator to advance round
- Is the next round yours? → Wait for round advancement, then go to step 2
- All your phases done? → Sign off in collab.md

If all phases done, the plan is complete.
