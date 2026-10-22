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
- Run pre-flight checks first, then append one status line (`learning`, "Pre-flight: N tests green.") to collab.md per [Status and wakes](collab.md#status-and-wakes)
- Append one line when your status moves to `working`

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

**If collab:** commits get no collab line. Append one line only when your status changes (no big ledgers).

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

**If collab:** before committing, check your status is current; append one line only if it changed.

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

**Phase-close gate — the lead owns it, and it runs BEFORE any `done` below.** The lead confirms that every
worker's CLEANUP RECEIPT for this phase is present (`/pr-loop` `references/merge-and-verification.md` § Cleanup
Receipt) and runs the prune step: `git worktree prune`, delete merged branches, roll `docs.local/<sprint>/` up into
one README. A missing receipt keeps the phase open until that worker posts it; the lead does not write it for them.
Lane close and settle require the implementer's `git worktree remove` (no `--force`), then `git worktree prune`,
and removal proof in the receipt: the path is absent from `git worktree list --porcelain`.
Preserve dirty files or local-only commits; name the path and reason and escalate to the lead.
A receipt without removal proof or a named, escalated exception is invalid.
In a sequential plan the executing agent is the lead.

Only after the gate passes, in `<plan-dir>/README.md`, mark the phase as done:
```
| N | Phase Name | folder | done | PR #XX merged |
```

Update findings.md with final notes.

**If collab:**
1. Append a timestamped, addressed Messages heading: `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done: PR #XX merged. Next: <what is unblocked>`, with your CLEANUP RECEIPT under it. The receipt comes first; the lead's gate reads it
2. The lead then overwrites STATUS.md: status → `done`, PR link (workers do not edit STATUS.md)
3. If ALL your assigned phases are done → status → `signed-off`
4. If this completes a round → the lead runs the phase-close gate above (every worker's CLEANUP RECEIPT present, prune step run) and only then advances to next round

**If blocked at any step:** append `### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked: <need/from whom>`. STATUS.md changes and unaddressed prose do not wake the tag-scoped collab monitor (cmux adapter); in T3 your final message wakes the lead via the completion notification.

### 11. Continue

**Sequential plan:** Check if there's a next phase. If yes, go back to step 2.

**Collab plan:** Check collab.md:
- Do you have more phases assigned in the current round? → Go to step 2
- Is the current round complete (all agents done)? → Wait for orchestrator to advance round
- Is the next round yours? → Wait for round advancement, then go to step 2
- All your phases done? → Sign off in collab.md

If all phases done, the plan is complete.
