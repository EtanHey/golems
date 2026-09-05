# Response: Sprint Agent Claims Verification

## CRITICAL RULE INVOKED
**NEVER FABRICATE.** Agents claim work is done. Before updating any summary or marking complete, I MUST verify the claims independently.

---

## Claims Received
1. **brainlayerClaude:** "all tests pass, PR merged"
2. **voicelayerClaude:** "TTS fix done, LaunchAgent working"

---

## What I WOULD Do (Exact Sequence)

### Step 1: Invoke Verification Skill
```
/superpowers:verification-before-completion
```
This is a MANDATORY trigger. Claims of "done" + "tests pass" + "PR merged" require proof.

---

### Step 2: Verify brainlayerClaude's Claims

#### Claim: "all tests pass"
**Action:** Run test suite, capture output
```bash
cd ~/Gits/brainlayer
npm test 2>&1 | tee /tmp/brainlayer-test-output.txt
```
**Then READ the output file:**
```
Read("/tmp/brainlayer-test-output.txt")
```
**Verification:** Only accept if:
- Last line shows "passed" or "✓" with count ≥ previous baseline
- No FAILED, ERROR, or timeout markers
- Exit code = 0

#### Claim: "PR merged"
**Action:** Check git history + GitHub
```bash
cd ~/Gits/brainlayer
git log --oneline --graph -10
gh pr list --state merged --limit 5
```
**Verification:**
- `git log` shows recent merge commit
- `gh pr list` shows the PR that was "done" in merged state
- PR title matches expected work (read PR body to confirm scope)

#### Detailed Check: What changed?
```bash
cd ~/Gits/brainlayer
# If PR was just merged, check the last merge commit
git show HEAD --stat
```
**Then READ the diff summary** to confirm:
- Tests were added, not removed
- Core logic matches the intent stated in the PR

---

### Step 3: Verify voicelayerClaude's Claims

#### Claim: "TTS fix done"
**Action:** Check the repo for what "TTS fix" means
```bash
cd ~/Gits/voicelayer
git log --oneline --grep="TTS" -10
gh pr list --state merged --limit 5
```
**Verification:**
- TTS-related commit exists in recent history
- If PR was merged, check its tests passed

#### Claim: "LaunchAgent working"
**This is vague.** Action: Ask for specifics OR check the code/tests
```bash
cd ~/Gits/voicelayer
find . -name "*launch*" -o -name "*LaunchAgent*" | head -20
grep -r "LaunchAgent" --include="*.ts" --include="*.swift" src/ tests/
```
**Then READ the test file** to see:
- Does a test for LaunchAgent exist?
- Does it pass (run the test)?
- Is it recent (merged in the PR)?

---

### Step 4: Check Collab File Status

**Action:** Read the active collab file
```
Read($ORCHESTRATOR_REPO/collab/<sprint-collab-file>)
```
**Look for:**
- Blocker status (any unresolved blockers = NOT done)
- Task checklist (all items checked?)
- PR links (can I verify PRs exist and are merged?)

---

### Step 5: IF All Verification Passes

Only then proceed to update Obsidian summary:

```bash
# Location of summary file (must exist first)
Read(~/Gits/golems/docs/obsidian-summary.md)
```

**Update with:**
- Timestamp of verification
- Links to merged PRs
- Test run results (copy the test output counts)
- Mark ✓ complete with evidence attached

**Append-only pattern:**
```bash
echo "## Verification Complete - 2026-03-18 HH:MM UTC
- brainlayerClaude: Tests passed (run output: X tests, 0 failures)
- PR #123 merged: <link>
- voicelayerClaude: LaunchAgent tests passing
- PR #456 merged: <link>
Verified by orcClaude via direct test runs + git log + gh CLI" >> summary.md
```

---

### Step 6: IF Verification Fails

**Blocker captured:**
```
brain_store(
  content: "Sprint claim failed verification: brainlayerClaude reported 'all tests pass' but npm test returned 3 failures in auth.test.ts. PR#123 is NOT merged (still in draft). Blocked pending agent response.",
  tags: ["blocker", "sprint-agents", "verification-failed"],
  importance: 9
)
```

Then notify user:
```bash
notify "Sprint Verification Failed" "brainlayerClaude tests not passing. Check /tmp/brainlayer-test-output.txt"
```

---

## Why This Matters

The global CLAUDE.md rule is clear:
> "NEVER claim tests pass, audits are green, or results look good without verification. If someone (agent, CLI tool, Cursor) wrote results to a file — READ THE FILE before reporting on it."

Agent claims ≠ verified facts. If I update Obsidian without checking:
1. Hidden test failures stay hidden
2. User thinks work is done, discovers PR isn't merged → wasted async cycles
3. orcClaude loses credibility as the "verification gate"

---

## The Answer to "Update Obsidian and Mark Complete"

**I CANNOT do that yet.** I must:
1. Run brainlayer tests + capture output + READ it
2. Check `git log` + `gh pr list` for merged PRs
3. Find + run voicelayer's LaunchAgent tests
4. Only THEN update Obsidian with evidence attached

**If all verification passes:** 30 seconds to update summary.
**If any check fails:** Blocker stored, user notified, summary NOT updated.

This is the "verification-before-completion" mandate in action.

---

## Summary: What I Would Actually Do

| Step | Action | Tool | Output Verification |
|------|--------|------|---------------------|
| 1 | Run brainlayer tests | `npm test` | Read `/tmp/` output, check exit code |
| 2 | Check brainlayer PR merge | `git log` + `gh pr list` | Confirm merge commit + PR#merged |
| 3 | Verify TTS changes | `git log --grep=TTS` | Read commit message + PR description |
| 4 | Run voicelayer tests | `npm test` (voicelayer) | Confirm LaunchAgent tests pass |
| 5 | Read collab file | `Read()` | Check for unresolved blockers |
| 6 | Update Obsidian | `Edit()` | Add evidence links + timestamps |

**Do NOT skip any step.** Every claim gets verified independently.
