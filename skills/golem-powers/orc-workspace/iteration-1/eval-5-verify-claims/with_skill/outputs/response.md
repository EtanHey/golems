# orcClaude Response — Verify Claims + Update Summary

## My Approach (Skill Applied)

I'm applying the **Verify Against Living Spec** pattern from the orcClaude skill (Pattern 3, lines 39-47). The user is asking me to trust agent self-reports ("all tests pass", "TTS fix done") and update summary documents. I **cannot do that without verification.**

Here's my exact sequence:

---

## 1. Brain-Layer Boot (Pattern 1 — BrainLayer-First)

```
brain_recall(mode="context")              # What sprint/project is this?
brain_search("sprint agents status")      # What's the actual state?
brain_search("Obsidian summary location") # Where is it?
```

**Why:** Before reading any file, I search what's already known. At ~50ms, this is faster than reading files and saves context for orchestration thinking.

---

## 2. Read the Living Spec (Pattern 3 — Verify Against Spec)

I'd read:
- The **collab file or sprint plan** that defines WHAT "complete" means
- Example: `$ORCHESTRATOR_ROOT/collab/sprint-kickoff.md` or `docs.local/plans/sprint-agents-work.md`

```
Read: <collab-file-path>
Extract: GOAL section → what are the acceptance criteria?
Extract: PR links for brainlayerClaude + voicelayerClaude
```

This is the **ground truth.** Not agent claims. Not Slack messages. The spec.

---

## 3. Never Trust Self-Reports — Verify Actual Output (Pattern 3, Lines 41-42)

For **brainlayerClaude** claim "all tests pass, PR merged":

1. Read the PR description (from GH API or collab file)
2. Check: Does the merged PR actually exist? `git log --oneline | grep -i brainlayer`
3. Check test count: Read the PR diff or run `gh pr view <number> --json checks`
4. Only THEN believe "all tests pass"

For **voicelayerClaude** claim "TTS fix done, LaunchAgent working":

1. Read the actual fix: `git show HEAD` or `gh pr view --json files`
2. Check: Is LaunchAgent in the merged code or just claimed?
3. Verify: Can I find `LaunchAgent` in the merged files or is it aspirational?
4. Check test coverage: Does the merged PR include tests for LaunchAgent, or is it untested?

**The rule from skill (line 61):** "Report on files without Read() / /never-fabricate — read, parse, then report"

I read the actual outputs, not the claims.

---

## 4. Verify Against Obsidian Summary (Pattern 3, Line 44)

Before updating:

```
Read: $ORCHESTRATOR_ROOT/docs.local/plans/<sprint-name-summary>.md
       (or wherever the Obsidian summary lives)

Check: Does the GOAL section in collab match what we're checking?
       Example:
         GOAL: Ship brainlayerClaude PR + voicelayerClaude TTS fix

Check: What's the CURRENT state in the summary?
       Status: In Progress? Blocked? Complete?

Check: Are the PR links in the summary live links?
       If PR links exist, click them and verify they're merged.
```

---

## 5. Update ONLY If Verified (Pattern 3, Line 46)

If verification passes:
- brainlayerClaude: PR is merged ✓, tests ran ✓, count is X ✓ → **then** update "brainlayerClaude — DONE"
- voicelayerClaude: PR is merged ✓, LaunchAgent exists ✓, tests exist ✓ → **then** update "voicelayerClaude — DONE"

If verification **fails** (e.g., "tests pass" but PR isn't merged):

```
brain_store(
  content: "voicelayerClaude claimed 'TTS fix done, LaunchAgent working' but actual PR #X: only TTS merged, LaunchAgent not in files. Self-report unreliable. BLOCKER: Missing LaunchAgent implementation.",
  tags: ["blocker", "sprint-agents"],
  importance: 9
)

Respawn voicelayerClaude in new pane with:
"PR shows TTS merged but LaunchAgent missing from files. Can you check: (1) Is LaunchAgent implemented? (2) If yes, is it in the PR diff?"
```

**From skill (line 52):** "Don't: Trust send_input ok:true | Do Instead: Verify delivery"

---

## 6. The Obsidian Summary Update (If All Pass)

If verification succeeds, I'd update like:

```markdown
## Sprint Status — March 18, 2026

### brainlayerClaude
- Status: **DONE** ✓
- PR: #X (merged)
- Test count: 47/47 passing
- Summary: KG rebuild, auto-context, 3-source audit

### voicelayerClaude
- Status: **DONE** ✓
- PR: #Y (merged)
- Changes: TTS optimization, LaunchAgent integration
- Test count: 23/23 passing

### Overall: All 4 sprint agents COMPLETE
- Verified against living spec ✓
- All PRs merged ✓
- All tests passing ✓
```

---

## Key Decisions

| Decision | Reasoning | Skill Rule |
|----------|-----------|-----------|
| Search BrainLayer first, not read files | Context is precious; search is fast | Pattern 1, Line 12 |
| Read the collab GOAL section | Defines "done" — not agent opinion | Pattern 3, Line 43 |
| Verify PR exists, tests ran, LaunchAgent in code | Never trust self-reports | Pattern 3, Lines 41-42 + Anti-pattern Line 61 |
| brain_store if verification fails | Turn blockers into persistent memory | Line 62 |
| Only update summary if verification passes | Mark complete when SPEC is satisfied, not when agent claims | Pattern 3, Line 46 |

---

## What I Would NOT Do

❌ Trust "all tests pass" without reading PR checks
❌ Claim "LaunchAgent working" without grep-ing the codebase
❌ Update the summary before verifying actual merged code
❌ Bulk-read files (use brain_search first)
❌ Make final claim without reading the GOAL in the collab file

---

## Summary

**I would NOT mark everything complete based on claims alone.** The orcClaude skill (Pattern 3) explicitly requires:

1. Read the living spec (collab GOAL)
2. Read the actual output (PR diffs, test runs, code)
3. **Only then** mark complete

**If verification fails, I respawn the agent in a new pane with the specific blocker.** The skill's anti-pattern (line 52) teaches: absorbing frozen work kills velocity. Respawn + delegate instead.

This is how orcClaude operates: **verify against spec, never trust self-reports, store blockers in BrainLayer, delegate continuation.**
