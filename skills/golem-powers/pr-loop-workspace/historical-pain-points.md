# PR-Loop Skill — Historical Pain Points

**Date:** 2026-03-18
**Sources:** BrainLayer search (6 queries), mining-synthesis.md, cc-changelog-gems.md, collab-v5-FINAL.md, dismissed-review-mining-march18.md, SKILL.md review
**Method:** 6 targeted BrainLayer searches + manual synthesis from tonight's sprint files

---

## META-FINDING: BrainLayer Cannot Surface PR-Loop Pain Points

**All 6 BrainLayer searches returned zero relevant results.** Queries tested:
1. `PR merge without review` → songscript PRD edits, Tailwind config
2. `daemon fix not tested real client` → React component code, email debugging
3. `PR loop skipped` → zikaron pipeline files, songscript test management
4. `CodeRabbit dismissed wrong` → Next.js config, taskowl audit instructions
5. `merge before review complete` → recovery metrics (Huberman!), songscript setup
6. `pr-loop correction user feedback` → brave-manager docs, rudy-monorepo CSS fixes

**Root cause:** BrainLayer's 322K chunks are 96.4% raw conversation transcript (tool calls, file paths, CSS edits). PR-loop decisions, corrections, and pain points were never explicitly `brain_store`d — they lived in conversation context and were indexed as low-signal assistant_text. Importance inflation (41% >= 7) means the filter can't separate process knowledge from code changes.

**SKILL FIX NEEDED: Post-merge `brain_store` step should include PR-loop process observations, not just what changed. When a PR loop fails or requires correction, that failure should be explicitly stored tagged `["pr-loop", "process-failure", "<repo>"]`.**

---

## Pain Points from Tonight's Sprint (Mining Synthesis)

### PP1: Daemon Fix Shipped Without Real Client Test
**Source:** Mining synthesis finding #1; dismissed review mining C1
**What went wrong:** BrainBar had 3 PRs (#87, #88, #89) before the actual framing mismatch was found. Each PR passed unit tests and socat tests. None tested with a real Claude Code session. The framing mismatch (newline-JSON vs Content-Length) only manifests with multi-message persistent MCP connections — not single socat requests.
**What the user wanted:** "Don't claim 'fixed' until a real Claude Code session connects and the tools work."
**Current SKILL.md status:** FIXED — Daemon Verification Gate added (lines 310-325)
**Remaining gap:** None for the gate itself, but the gate is text-only guidance. No enforcement mechanism.

**SKILL FIX NEEDED: The daemon gate should be in the Step 4 (VERIFY) section with a conditional trigger, not a separate section at the end. When the skill is skimmed, the daemon gate is easy to miss because it's after the "Composability" and "Quick Reference" sections.**

### PP2: Dismissed CodeRabbit Comments Hiding Real Bugs
**Source:** Dismissed review mining (full report); mining synthesis finding #1 backstory
**What went wrong:** PR #84 (BrainBar daemon) received 5 MAJOR+ CodeRabbit comments including:
- C1: Serial queue spin on slow client (likely root cause of BrainBar socket death)
- C2: sun_path buffer overflow (memory corruption risk)
- H1: Nonblocking socket partial writes silently truncate responses
- H3: brain_search silently ignores advertised filter parameters
- H4: Placeholder tools return fake success (silent data loss)

None received any reply. No fix, no acknowledgment, no "@coderabbitai this is intentional because X."
**What the user wanted:** "Investigate before dismissing" — which is already in the skill (lines 164-209). But PR #84 didn't dismiss — it IGNORED. No reply at all.
**Current SKILL.md status:** "Investigate Before Dismissing" section exists and is thorough.

**SKILL FIX NEEDED: Add "No Silent Ignoring" rule — CRITICAL/MAJOR comments require EXPLICIT reply (fix, acknowledged-wont-fix-because-X, or investigating). Zero replies on a PR with 5+ MAJOR comments should be flagged. The current skill handles the "dismiss with wrong reason" case but not the "don't reply at all" case.**

### PP3: Merge Without Waiting for Review (0-Review Merge)
**Source:** Mining synthesis finding #4 (implicit), collab-v5-FINAL.md (agent patterns)
**What went wrong:** Multiple instances across the ecosystem where PRs were created and merged in the same breath — push → PR → merge with no review wait. Tonight's sprint design had to explicitly build "CodeRabbit timeout: 15 min" and "Wait minimum 10-15 min" into agent kickoff prompts because the skill alone wasn't preventing this.
**What the user wanted:** Minimum review time enforced.
**Current SKILL.md status:** Eval 4 tests this scenario. Lines 80-95 cover the rule. Lines 253-261 enforce minimum 2 rounds.

**SKILL FIX NEEDED: The 10-15 min wait is buried in a code comment on line 85. For autonomous agents, this needs to be a top-level rule with a timer: "After requesting review, do NOT check for reviews for at least 120 seconds. After 120s, check once. If no reviews, wait another 120s. After 5 minutes with no reviews, invoke reviewers explicitly."**

### PP4: Agents Don't Follow PR Loop When Running Autonomously
**Source:** Collab-v5-FINAL.md kickoff prompts; mining synthesis context
**What went wrong:** Collab kickoffs had to redundantly specify "invoke /pr-loop for every PR" and "merge policy: autonomous. CodeRabbit timeout: 15 min." The skill should be self-contained — agents that load the skill shouldn't need additional reminders in their kickoff prompts.
**What the user wanted:** Skill is the single source of truth. No redundant instructions in kickoff prompts.

**SKILL FIX NEEDED: Add an "Autonomous Agent Mode" section at the top of the skill that says: "If you are an autonomous agent (no human in the loop), these additional rules apply: (1) Never merge with 0 reviews — wait or invoke bots. (2) CodeRabbit timeout: 15 min — if no response, self-merge after CI green. (3) Post to collab file with PR number immediately after creation. (4) Post to collab file after merge with test counts." This makes the autonomous rules first-class, not scattered across kickoff templates.**

### PP5: Post-Merge Tracking Done Inconsistently
**Source:** Mining synthesis (implicit); collab-v5-FINAL.md fixesClaude section
**What went wrong:** fixesClaude's sprint results showed stale numbers in portfolio, roadmap, and showcase — meaning post-merge tracking was inconsistent across sessions. The "After Merge: Update Tracking" section (lines 293-306) exists but isn't always followed.
**What the user wanted:** Every merge updates collab + roadmap + BrainLayer. No exceptions.

**SKILL FIX NEEDED: The post-merge tracking section should include specific `brain_store` content with tags. Current guidance is "brain_store what changed and why (tagged pr-merged, <project>)" but doesn't specify the format. Add a template: `brain_store("PR #{N} merged: {title}. Changes: {1-line summary}. Tests: {count}.", tags=["pr-merged", "{project}"], importance=6)`**

### PP6: Score >= 9 Gate Not Enforced (Planning Paralysis)
**Source:** Mining synthesis finding #4
**What went wrong:** Sprint planning (architect-critic-synthesize) ran 9 iterations. v3 was approved at 9/10 but orcClaude kept designing through v4, v4.1, v4.2, v5. "Longer than the sprint it was planning."
**What the user wanted:** Numeric gate: score >= 9 = LAUNCH. No more iterations.
**Current SKILL.md status:** Not covered (this is a collab/planning pattern, not a PR loop issue per se).

**SKILL FIX NEEDED: This doesn't belong in pr-loop directly. But the principle applies to review rounds too: add to the multi-round section (lines 253-263): "Max 3 review rounds for any PR. If round 3 still has new issues, merge and create follow-up ticket. Infinite review loops are worse than shipping with known minor issues."**

### PP7: PR #84 Had No Reply to 5 CRITICAL/HIGH Findings — Merged Anyway
**Source:** Dismissed review mining
**What went wrong:** BrainBar PR #84 was merged with zero replies to 5 critical/high CodeRabbit findings. The findings included the exact mechanism that caused BrainBar socket death in production.
**What the user wanted:** CRITICAL findings block merge. No exceptions. You can dismiss with a reason but you cannot ignore.

**SKILL FIX NEEDED: Add to "Classify each review comment" table (line 201): new severity `CRITICAL (data loss, security, crash)` → `MUST fix OR explicitly document why not. Zero reply = CANNOT merge.` Add a pre-merge checklist: "Before `gh pr merge`: (1) All CRITICAL/HIGH comments have a reply. (2) All fixes have been pushed. (3) Re-review requested after fixes."**

### PP8: Component Reasoning Not Stored After Merge
**Source:** SKILL.md lines 362-375 (the section exists)
**What went wrong:** The "Store Component Reasoning" post-merge step exists but is rarely followed. No historical BrainLayer entries were found for component reasoning (0 results for any pr-related brain_store).
**What the user wanted:** Future Claude sessions don't re-discover "why was X built this way."

**SKILL FIX NEEDED: The component reasoning section references a template file that may not exist. Simplify to an inline template: `brain_store("New file: {path} ({lines} lines). Purpose: {why}. Key decisions: {list}. Alternatives considered: {list}.", tags=["component-reasoning", "{repo}", "pr-{N}"], importance=7)` — no external template dependency.**

---

## Pain Points from BrainLayer Search Failure (Meta-Level)

### PP9: Process Knowledge Not Stored in BrainLayer
**What went wrong:** 6 targeted searches for PR-loop failures, corrections, and pain points returned zero relevant results. All results were raw conversation transcript (tool calls, file edits, CSS changes).
**Root cause:** Neither the pr-loop skill nor any agent workflow explicitly `brain_store`s process failures. When a PR loop goes wrong (merge without review, daemon gate missed, critical comment ignored), the failure lives in conversation context that gets compacted and indexed as low-importance assistant_text.

**SKILL FIX NEEDED: Add a "Process Failure Storage" section: "When ANY step of the PR loop fails or requires user correction, brain_store the failure: `brain_store("PR-loop failure: {what went wrong}. Correction: {what user wanted}. Root cause: {why the skill didn't prevent this}.", tags=["pr-loop", "process-failure", "{repo}"], importance=8)`. This builds a searchable history of pr-loop failures for future skill improvements."**

### PP10: No Eval for Post-Merge Tracking
**What went wrong:** The post-merge tracking section (collab, roadmap, BrainLayer) has no eval coverage. All 9 existing evals test pre-merge behavior (review, verification, classification). None test what happens AFTER merge.

**SKILL FIX NEEDED: Add eval 10: "After merge, does the agent update collab file, roadmap, and brain_store?" Prompt: "PR #42 just merged (feat: add search filters). You're working on a collab sprint. What do you do next?" Assertions: updates-collab-with-pr-number, updates-roadmap-if-applicable, brain-stores-merge-with-tags, does-not-stop-at-merge.**

---

## Summary: Skill Fixes Needed (Prioritized)

| # | Fix | Priority | Lines Affected | Source |
|---|-----|----------|---------------|--------|
| PP2 | Add "No Silent Ignoring" rule for CRITICAL/HIGH comments | **P0** | After line 209 | dismissed-review-mining |
| PP7 | CRITICAL findings block merge — pre-merge checklist | **P0** | Lines 201-215 | dismissed-review-mining |
| PP1 | Move daemon gate into Step 4 (VERIFY) conditional flow | **P1** | Lines 310-325 → lines 24-26 | mining synthesis #1 |
| PP4 | Add "Autonomous Agent Mode" section | **P1** | New section at top | collab-v5-FINAL |
| PP3 | Explicit timer for review wait (not just a comment) | **P1** | Lines 80-95 | mining synthesis, collab |
| PP9 | Add process failure brain_store on correction | **P1** | New section | BrainLayer meta-finding |
| PP5 | Standardize post-merge brain_store format with template | **P2** | Lines 293-306 | fixesClaude findings |
| PP6 | Max 3 review rounds circuit breaker | **P2** | Lines 253-263 | mining synthesis #4 |
| PP8 | Inline component reasoning template (no external dep) | **P2** | Lines 362-375 | SKILL.md review |
| PP10 | Add eval for post-merge tracking | **P2** | evals.json | eval coverage gap |

---

*Generated: 2026-03-18 | BrainLayer queries: 6 (all returned irrelevant results — see PP9) | Sprint files: 4 read in full | SKILL.md: read and cross-referenced*
