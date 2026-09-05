---
name: pr-loop
description: "Full PR loop: branch, test, commit, push, PR, review, fix, merge — plus the agent-identity signature required on every GitHub write. Triggers: create PR, finish work, post PR comment, sign a comment, golem-id, Co-Authored-By trailer."
---

# PR Loop

> Fleet law: canon #2 owns branch→commit→push→PR→review→merge and PR URL validity. This skill keeps the procedural checklist, review handling, edge cases, and worker-vs-lead merge mechanics.

## Loop Endpoint

A lead's endpoint is a merged PR plus cleanup. A worker's endpoint is a
ready-for-review PR with review responses addressed and its URL handed to the
lead; workers do not merge.

**Mechanical enforcement (gen-18 Track 1):** parking is now caught by the
**idle-dwell gate** — a finished, approved branch left "awaiting PR approval" is
`IDLE_SEAT_OPEN_QUEUE`. Run `/idle-dwell-gate` on the terminal turn before ending
(`bun skills/golem-powers/idle-dwell-gate/scripts/idle-dwell-gate-cli.mjs <transcript|->`,
exit 3 = FLAG). FLAG ⇒ finish the loop to the authority-appropriate endpoint:
MERGED for a lead, or reviewed PR handoff for a worker. Surface the PR number,
not a permission question.

## Stop-State and End-State (Astra digest 2026-09-05, §2 L60 / §3 L131 / §4 L146)

**End state, precisely:** done = review bots and required checks GREEN on the **LATEST** commit. Not
"a green run exists" — green on the commit that is actually at the head of the PR.

**The four explicit turns**, in order, none skipped and none merged into a neighbour:
1. fix
2. commit + push + open/update the PR
3. babysit to green on the latest commit (invoke bots, answer findings, re-push)
4. merge **only on instruction** (lead authority or the brief's merge policy)

**Stop-state clause — when you stop before the end state (no PR, or PR not merged):** state exactly
where you stopped and what the next turn is. "Stopped after step 2: PR #N is open, CI running, next is
step 3 babysit" is a valid stop. "Done" without a PR URL, or silence, is not. The Astra digest's worst
observed behaviour was stopping at the literal question and repeating the same stop after correction —
a stop-state line is what makes a stop legible instead of a stall.

## Autonomous Agent Mode

If you are running autonomously (no human in the loop), these rules are mandatory:

1. **Never merge with 0 reviews.** Wait or invoke bots. No exceptions.
2. **Review wait timer:** After invoking reviewers, wait minimum 120s before first check. If no reviews after 5 min, re-invoke. Fifteen minutes with no response does not waive the review gate: a lead may merge only after at least one review and all required comment/review conditions pass; a worker hands off unmerged.
3. **Post to collab** with PR number immediately after creation and after worker handoff or lead merge (with test counts).
4. **CRITICAL/HIGH comments require reply** before handoff or merge — fix, or explicit "won't fix because X." Zero replies = cannot advance.
5. **Max 3 review rounds.** If round 3 still has new non-critical issues, a lead with merge authority may merge and create a follow-up ticket; a worker hands off the reviewed PR with those issues documented. Infinite review loops are worse than shipping with known minor issues.

## Hierarchical Worker Mode (gen-12 weave E09)

When a dispatch brief says **LEAD owns merge** (or "worker endpoint = PR + review
responses"):

- Worker's endpoint = **PR opened + review responses addressed** — do NOT
  re-derive `MISSION = MERGED` or merge locally.
- Worker stops at: branch → implement → verify → commit → push → PR → invoke
  reviewers → fix review threads → post TASK_DONE with PR URL.
- LEAD merges after a clean loop on the worker PR.
- A worker must hand the reviewed PR to its lead unmerged.

Evidence: two independent re-derivations of the conflict (vlW7#5 "brief explicitly
says no merge"; kg-harvest#2).

## Review-Without-Merge ≠ Draft (gen-12 weave E09)

Draft PRs **silently skip bot reviews** (CodeRabbit skipped a PR because it was
draft — phoenix-revival#3).

```
WRONG: gh pr create --draft … then wait for @coderabbitai
RIGHT: Create ready-for-review PRs; if draft was used, `gh pr ready <N>` BEFORE
       invoking reviewers. Never merge while still draft.
```

"Review without merge" means mark ready-for-review and run the review loop — NOT
leave the PR in draft state.

## Lead Merge-Timing (gen-12 weave E09)

LEAD (or any merger) must **never merge a worker's PR mid-review-fix**:

```bash
# BEFORE gh pr merge — confirm head matches worker's latest push
gh pr view <N> --json headRefOid,commits,reviewDecision
```

Checklist:

- [ ] `headRefOid` matches the worker's latest pushed commit (not an earlier SHA
      mid-fix)
- [ ] No open CRITICAL/HIGH review threads awaiting a fix push
- [ ] Re-review requested after the final fix commit

Evidence: #257 merged at `61d6f50` before fix `750efdd` landed (recovered via
#260); #256 same evening — stranded fixes.

## Deploy Truth Gate (gen-12 weave E09)

Fleet law for user-visible completion lives in canon #4. Before emitting `TASK_DONE` or any "done / deployed / green / render-complete" message, run the **false-green gate** on the turn (hook-enforced; not model-invocable) —
`bun skills/golem-powers/false-green-gate/scripts/false-green-gate-cli.mjs <transcript|->`,
exit 3 = FLAG. A FLAG means the claim is unearned — run the missing live probe, then claim. Compose with `/deploy-verify`, `/render-done-gate`, and `/qa-verdict-gate` as the domain requires.

## PR-Referenced Artifacts Must Be Committed (gen-12 weave E09)

Artifacts cited in PR bodies, review threads, or merge verification **cannot live
only in gitignored `docs.local/`** — reviewers and CI cannot fetch them.

```
WRONG: PR body links orchestrator/docs.local/plans/foo.md (gitignored)
RIGHT: Commit the artifact to a tracked path, paste the excerpt inline, or link
       a committed copy; docs.local is local cache only when a committed record exists
```

Evidence: phoenix-revival#7.

## Single-Account Review Verdicts (gen-12 weave E09)

On EtanHey repos (single GitHub account), agent PR verdicts go as **PR comments**
— inline review comments or `gh pr comment` — NOT formal self-review
REQUEST_CHANGES (GitHub blocks self-approve/self-request-changes).

```
WRONG: gh pr review --request-changes on your own PR
RIGHT: Post structured verdict as a PR comment; merge authority follows Merge
       Authority below after a clean bot-reviewed loop
```

Evidence: codexE08#5. Complements the existing Merge Authority single-account note.

## Agent Identity Signature (MANDATORY on every GitHub write — ratified 2026-08-08)

**Full spec + failure-mode catalog: [references/github-identity.md](references/github-identity.md).**
Read it before your first signed write; the rules below are the enforceable summary.

Every agent-authored **PR comment, PR body, PR review, issue comment, and inline review reply** ends
with a two-part block:

```
— brainlayerClaude (lead) · claude-code/opus-4.6
<!-- golem-id v1 {"seat":"brainlayerClaude","role":"lead","harness":"claude-code","model":"claude-opus-4.6","model_source":"session-jsonl","session":"db7f3bb9","ts":"2026-08-08T18:40:00Z"} -->
```

Visible line: `— <seat> (<role>) · <harness>/<model>`. Blob: **one line** of JSON, always last.

1. **`seat` / `role` / `harness` come from launcher env** (`GOLEM_SEAT`, `GOLEM_ROLE`,
   `GOLEM_HARNESS`). `model` does NOT.
2. **`model` is read from LIVE session metadata at write time** — never the model's self-report
   (AP7), never the cmux spawn registry (the `xhigh`-lie surface), never cached at spawn (Etan
   switches models mid-session). Re-read per invocation. Cannot read it? `"model":"unknown",
   "model_source":"unavailable"` — guessing is fabrication. Per-harness read paths: see the adapters.
3. **No `effort` field anywhere on GitHub** — not the line, not the blob, not the commit trailer.
   Effort is registered at the BrainLayer commit/PR checkpoint only (ratified v1.1).
4. **Ownership marker:** on `EtanHey`-owned repos the line stays plain; on anyone else's repo it
   opens with possession — `— EtanHey's brainlayerClaude (lead) · …`.
5. **Unsigned means human.** Raw `gh` outside a launcher is Etan himself — never sign for him, and
   never strip your own signature.
6. **Commit trailer** replaces the fixed model-only string:
   `Co-Authored-By: <seat> running <model> <noreply@anthropic.com>` — same provenance rules, no
   effort clause. One `Co-Authored-By` line, not two (this replaces the harness default wording).

A `gh()` wrapper that injects all of this automatically is designed but **not built** (golems /
repoGolem lane). **Until it ships, append the block by hand** — via `--body-file` or a heredoc so
the blob is not mangled by shell quoting.

## The Full Loop

```
1. BRANCH    git checkout main && git pull && git checkout -b feat/name
2. IMPLEMENT Write code — write the failing test FIRST (AGENTS.md law);
             the /tdd-guard hook enforces the edit limit
3. TEST      Run full test suite — ALL must pass
4. VERIFY    Invoke /never-fabricate
             ↳ DAEMON GATE: If this PR touches daemon/socket/MCP code,
               you MUST test with a real client session before proceeding.
               See "Daemon Verification Gate" below.
5. COMMIT    git add <specific files> → CodeRabbit pre-commit review → commit
             ↳ Codex env: run `coderabbit review --agent` with a ~3 minute
               hard timeout BEFORE committing. If the local CLI hangs or hits
               rate/review limits, stop it, record the limitation, and commit
               on fresh test evidence. After the PR exists, require PR-level
               bot status/comments before merge.
               If CRITICAL issues found → fix first. If minor → proceed.
               Ralph mode: `--story=ID --message=MSG` for atomic commit + criterion.
             ↳ Commit trailer = `Co-Authored-By: <seat> running <model>
               <noreply@anthropic.com>` (Agent Identity Signature above).
6. PUSH      git push -u origin feat/name
7. PR        Create PR (see "Creating the PR" below) — body ends with the signature block
8. REVIEW    Fetch + read review comments (see "Reading Reviews" below)
             ↳ Every comment/reply you POST ends with the signature block
9. FIX       Address real bugs from review
10. MERGE    gh pr merge <N> --merge --admin --delete-branch
             ↳ Leads are ADMINS on Etan's repos: `--admin` is the DEFAULT.
               `reviewDecision: REVIEW_REQUIRED` is a GitHub LABEL, never a
               stop condition. See "Merge Authority" below.
11. CLEANUP  git checkout main && git pull
```

## Merge Authority (Etan's ruling, 2026-08-04 — mechanism, not prose)

> *"The reason we have branch protection on my own repos is so OTHER PEOPLE don't merge to my
> repo. Our agents are working on things I asked for — that's why the leads are there, they have
> full permission to merge when they see something is really good. It's not GitHub's approval
> you're waiting for, it's my approval, and it's stupid."*

1. **Branch protection exists to stop OUTSIDERS. Leads are not outsiders.** On Etan's repos,
   leads merge with **`gh pr merge <N> --admin`** as the default. A protection rule is never a
   reason to stop, wait, or report "blocked."
2. **`reviewDecision: REVIEW_REQUIRED` is a GitHub label, not a refusal.** The ONLY real merge
   blockers are: **actual conflicts · failing CI · an unresolved review finding**. Nothing else.
3. **The review step above still happens** (independent reviewer ACCEPT per lane contract —
   rules 1–5). What is abolished is the *post-review* stop: once the lane's review is clean,
   MERGE. Do not wait for a human, GitHub, or a permission that already exists.
4. **Never fabricate a missing authority.** "Etan has NOT granted merge" without a verbatim
   Etan statement for THIS lane is the fabricated-authority class (weave-verified specimen).
   Absence of a grant is not a revocation — the standing grant above is the default.
5. **Why this is a gate, not advice — measured cost of the opposite:** nine brainlayer PRs sat
   unmerged on the label (one 9 days old; six merged within 15 minutes of using `--admin`), and
   unreleased merge #638 meant enrichment restarted against a 15-day-old binary and **overwrote
   `provenance_class` on 5,137 rows.** Unmerged reviewed work is not neutral; it costs data.

> [!IMPORTANT]
> **R-010 interim merge law (2026-07-10):** merge commits are the default.
> Etan's conditional ruling was: "if we can trace everything back to the commits
> in BrainLayer... then it's fine that we do PR squashes, but we need to make
> sure that's the case." Squash returns only after the commit-traceability gate
> ships and BrainLayer-present detection is verified. Check the canonical
> registry's R-010 row state before assuming that condition has been discharged.

---

## Git Sanitization Gate (MANDATORY)

- [ ] `git status` is clean (no uncommitted changes, no staged or unstaged work-in-progress)
- [ ] If untracked files exist, each one is explicitly accounted for with:
  - `keeping because X`, or
  - `should be gitignored`, or
  - `committing now`
- [ ] No stale branches are left behind
- [ ] Working directory is on the expected branch for this task

## Codex Worktree Patch Gate

If the assigned worktree differs from the session cwd, every `apply_patch` filename must be an absolute path inside the worktree. `exec_command.workdir` does not apply to `apply_patch`; relative patch paths resolve against the session cwd and can mutate the main checkout silently. If a patch lands unexpectedly, check `git status` in both the main checkout and the assigned worktree before continuing.

## Step 7: Creating the PR

### Prerequisites

- `gh` CLI installed (`brew install gh`)
- Authenticated: `gh auth login`
- On a feature/fix branch (not main/master/dev)
- All changes committed

### Create the PR

```bash
# Push branch first
git push -u origin HEAD

# Create PR with structured body
gh pr create --title "feat: description" --body-file - <<'EOF'
## Summary
- What changed and why

## Test plan
- [ ] Tests pass
- [ ] Manual verification done

— golemsClaude (lead) · claude-code/opus-4.6
<!-- golem-id v1 {"seat":"golemsClaude","role":"lead","harness":"claude-code","model":"claude-opus-4.6","model_source":"session-jsonl","session":"db7f3bb9","ts":"2026-08-08T18:40:00Z"} -->
EOF
```

The signature block goes **last** in the body, and the same block ends every PR
comment, review, and issue comment (Agent Identity Signature above). Commits use
the `Co-Authored-By: <seat> running <model>` trailer instead — never the block.

If the PR body or comment contains backticks, use `--body-file` (or stdin).
Shell command substitution will mangle inline code and can silently rewrite the
evidence you meant to preserve — including the `golem-id` blob.

### Edge Cases

- **On main/dev/master**: Don't create PR. Switch to a branch first.
- **Uncommitted changes**: Commit first.
- **PR already exists**: Use `gh pr view` to check, don't create duplicate.
- **Custom base branch**: `gh pr create --base dev`

---

## Step 8: REVIEW (The Critical Step)

**This is NOT optional. This is NOT "auto-merge."**

### NEVER Merge With 0 Reviews

```bash
# Check BEFORE merging — empty reviewDecision + <2 comments = nobody looked
gh pr view <N> --json reviewDecision,comments
```

**Review Wait Timer (ENFORCED):**
1. After invoking reviewers → wait minimum **120 seconds** before first check
2. If no reviews after 120s → check again at **5 minutes**
3. If still no reviews at 5 min → re-invoke reviewers explicitly
4. After **15 minutes** with no response → a lead with merge authority may merge
   only if CI is green; a worker hands off the reviewed PR unmerged

CLEAN status with no reviews ≠ approved. It means NOBODY LOOKED.

| Bot | Expected time | Notes |
|-----|--------------|-------|
| CodeRabbit | 2-5 min | Auto-reviews on push |
| Greptile | Needs OSS approval | Manual activation |
| Macroscope | Needs activation | Auto-reviews once installed |

**If `reviewDecision` is empty and `comments < 2` → DO NOT MERGE.**

### Step 8a: Invoke Reviewers

Always explicitly request reviews. Don't wait for auto-detection.

```bash
# Invoke all available reviewers (do this right after PR creation)
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@greptileai review"
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@cursor @bugbot review"
```

Bot-invocation comments are agent-authored PR comments, so the signature block
applies to them too — the `gh()` wrapper will append it automatically once it
ships; until then, sign them by hand like any other comment.

Reviewer roster reality can degrade. If Greptile is unavailable, Cursor/Bugbot
is billing-blocked, or CodeRabbit is rate-limited, do not burn dead mentions.
Use Codex + Macroscope + `cr review --plain` before commit, and document which
reviewers were unavailable in the PR.

### For private repos (no bot reviewers):

```bash
# Option A: Use coderabbit:code-reviewer subagent
Agent(subagent_type="coderabbit:code-reviewer", prompt="Review PR #N")

# Option B: Use cr CLI
coderabbit review --agent  # Codex env, bounded to ~3 minutes
```

### For public repos (bot reviewers configured):

```bash
# Poll for reviews (preferred: /loop 2m, or CronCreate */2, or manual sleep 90)
gh pr view <N> --comments
```

### Reading Review Comments

Fetch comments from all review sources with full context:

```bash
# Quick view of all comments
gh pr view <N> --comments

# Detailed: get review comments with diff context
gh api repos/{owner}/{repo}/pulls/{N}/comments
```

To reply to an inline review thread, use the replies endpoint:

```bash
gh api --method POST \
  repos/{owner}/{repo}/pulls/{N}/comments/{comment_id}/replies \
  -f body='Fixed in commit abc123.'
```

`comment_id` is the numeric top-level review comment ID, not a node ID. Replies
are one level deep; you cannot reply to an existing reply. The bare comments
collection path does not reply to a thread; use `/replies` or the documented
`in_reply_to` form.

**Review sources (coverage stack):**

| Source | Type | How to Trigger / Check |
|--------|------|----------------------|
| CodeRabbit | AI review + auto-summaries | Auto on PR. Also: CodeRabbit plugin or `coderabbit review --agent` in Codex env (`cr review --plain` for human terminal use) |
| Codex Cloud | AI code review | `gh pr comment <N> --body "@codex review"` or comment manually on GitHub. Auto-reviews if enabled in Codex settings. Reads AGENTS.md "Review guidelines". Flags P0/P1 by default. |
| Cursor Bugbot | Bug detection | `gh pr comment <N> --body "@cursor @bugbot review"` or comment manually on GitHub. For re-review after fixes: `gh pr comment <N> --body "@cursor @bugbot re-review"`. Bot responds as `cursor[bot]`. |
| Greptile | AI review + codebase understanding | Comment `@greptileai review`. Needs OSS activation. |
| DeepSource | Static analysis | Check via CI status |

**After fixing review feedback, trigger re-review on every reviewer:**

```bash
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@cursor @bugbot re-review"
```

**Codex Cloud is enabled on:** EtanHey/voicelayer, EtanHey/orchestrator, EtanHey/golems, EtanHey/brainlayer.

### Investigate Before Dismissing (CRITICAL)

**Default stance = "let me investigate" — NOT "this is intentional."**

The worst PR loop failure mode: auto-dismissing a reviewer suggestion with "intentional per design doc" without checking if the reviewer found a real gap the design doc missed.

```
WRONG:
CodeRabbit: "Missing orphan reparenting when a node is deleted"
You: "@coderabbitai This is intentional per phase5-v2-synthesis.md. Please learn this."
Later: Realize CodeRabbit was right. Design was wrong. You taught it a bad Learning.

RIGHT:
CodeRabbit: "Missing orphan reparenting when a node is deleted"
You: Read the design doc. Does it explicitly address THIS tradeoff?
  → Yes, with clear reasoning → Push back with the specific passage.
  → No, or vague → Treat as potential gap. Investigate before closing.
```

**The investigation protocol for any "conflicts with design" suggestion:**

1. Read the actual design doc section referenced — don't rely on memory
2. Ask: does this doc EXPLICITLY address the tradeoff the reviewer raised?
3. If yes, with clear reasoning → reply with the specific passage
4. If no, or only implicitly → investigate the reviewer's concern as a real gap
5. If the design doc is WRONG → update the design doc AND correct any bad Learnings already taught

**Teaching a reviewer a bad Learning is worse than not teaching it anything.**
A false Learning suppresses future flags on a real bug category. Audit any Learning you've set if the underlying assumption turned out to be wrong:

```bash
# CodeRabbit: flag a Learning for correction
@coderabbitai I need to correct a previous learning. [Pattern X] does actually require
[handling Y] — our earlier design was incomplete. Please update your understanding:
[correct explanation].
```

### No Silent Ignoring (CRITICAL — from dismissed review mining)

**Every CRITICAL or HIGH review comment MUST receive an explicit reply.** Not fixing is acceptable. Not replying is NOT.

```
WRONG: PR #84 had 5 CRITICAL/HIGH CodeRabbit findings. Zero replies. Merged.
       → One of those findings was the root cause of BrainBar socket death.

RIGHT: Every CRITICAL/HIGH comment gets one of:
  1. "Fixed in commit abc123" (fix)
  2. "Won't fix because X — [specific technical reason]" (acknowledged)
  3. "Investigating — will address in follow-up PR #N" (deferred with ticket)
```

**Pre-merge checklist (verify before `gh pr merge`):**
- [ ] All CRITICAL/HIGH comments have a reply
- [ ] All fixes pushed and re-review requested
- [ ] No unacknowledged comments from any reviewer

### The Receiving Pattern (from /coderabbit)

```text
1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate requirement in own words (or ask)
3. VERIFY: Check against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

**Forbidden responses:** NEVER say "You're absolutely right!", "Great point!", "Thanks for catching that!" — instead restate the technical requirement, ask clarifying questions, or just fix it silently.

**Implementation order (multi-item feedback):**
1. Clarify anything unclear FIRST
2. Blocking issues (breaks, security)
3. Simple fixes (typos, imports)
4. Complex fixes (refactoring, logic)
5. Test each fix individually

Max 3 review-fix rounds — skip persistent nitpicks after that.

### Classify each review comment:

| Type | Action |
|------|--------|
| **CRITICAL** (data loss, crash, security) | FIX. Blocks merge. Must reply. |
| **MAJOR** (real bug) | FIX immediately. Push fix. Re-review. Must reply. |
| **TRIVIAL** (style, nitpick) | Fix if genuinely better. Skip if bikeshed. |
| **CONFLICTS WITH DESIGN** | INVESTIGATE first. Only dismiss with explicit doc evidence. |

When in doubt, the reviewer might be right. Push back only with explicit evidence.

### Teaching Each Reviewer (permanent compounding knowledge)

Every PR is an opportunity to make reviewers smarter. Use the right format for each.

| Reviewer | How it learns | Reply format | What persists |
|----------|--------------|--------------|--------------|
| **CodeRabbit** | `@coderabbitai` replies → explicit Learnings | `@coderabbitai [explain design]. See [doc]. Please learn this for future reviews.` | Permanent Learning applied to ALL future reviews on this repo |
| **Greptile** | Observes all reply patterns passively | Any plain reply explaining the design decision | Updates internal preference model — stops flagging dismissed patterns |
| **Macroscope** | `macroscope.md` file in repo root (no reply-learning) | Add rule to `macroscope.md` file | Persists as a repo-level rule, referenced in every future review |

**CodeRabbit** — reply with `@coderabbitai [explain design]. Please learn this for future reviews.` Never just "I'll leave this as-is" — that teaches nothing.

**Greptile** — reply naturally with design context. It passively learns from your replies.

**Macroscope** — add rules to `macroscope.md` in repo root. No reply-learning.

**Rule:** Always reply with context. The reply compounds knowledge across every future PR.

### Multi-Round Loop (minimum 2 rounds before merge)

```
Round 1: Push fixes → request re-review from all bots
Round 2: Read re-review → fix any new issues found
Round 3+: Only if new issues surfaced. Max 3 rounds for nitpicks.
```

CodeRabbit auto-re-reviews on new pushes. For others, comment `@bot re-review` explicitly.

**If reviewer finds new issues in round 2 → fix and go to round 3. Never merge with open issues.**

### Sanitize Before PR (CRITICAL)

Never put real client data in public PRs:
- ❌ Real phone numbers, JIDs, group names, client names
- ❌ Real Supabase row IDs or user UUIDs
- ✅ Realistic but fake examples: `+1-555-0123`, `client-abc-123`, `Group: Example Co`

Sanitize in PR description, code comments, test fixtures, and commit messages.

### After addressing reviews:

```bash
git add <files> && git commit -m "fix: address review feedback"
git push
# Wait for re-review — CodeRabbit auto-triggers, others need manual @mention
```

### Only THEN merge (after minimum 2 review rounds):

```bash
# Verify reviews are actually in before merging
gh pr view <N> --json reviewDecision,comments

gh pr merge <N> --merge --delete-branch
git checkout main && git pull
```

### Worktree-Locked Local Merge (2026-06-07 weave E12)

In multi-worktree repos, `gh pr merge <N> --merge --delete-branch` can fail
**locally** even though the PR is fully mergeable: the post-merge branch cleanup
checks out the default branch, and git refuses when another worktree holds it
(`failed to run git: fatal: 'main' is already used by worktree at
'$HOME/Gits/brainlayer-prod'`).

1. **Verify remote BEFORE retrying.** The remote merge often already succeeded —
   only the local checkout/delete failed:
   `gh pr view <N> --json state,mergedAt,mergeCommit`. If `state` is `MERGED`,
   do NOT re-merge; finish cleanup only.
2. **Remote fallback.** Merge server-side without touching local checkouts:
   `gh api graphql` with the `mergePullRequest` mutation, or
   `gh api -X PUT repos/{owner}/{repo}/pulls/<N>/merge -f merge_method=merge`.
3. **Delete the remote branch explicitly.** After a remote/API merge the branch
   can survive auto-cleanup — check `gh api repos/{owner}/{repo}/branches/<branch>`
   and `git push origin --delete <branch>` if it is still there.
4. **Pull main where main lives.** Update the worktree that actually holds the
   default branch (`git -C <main-worktree> pull`), not the linked worktree you
   worked in.

Known topology: brainlayer — `main` is held by `$HOME/Gits/brainlayer-prod`; briefs
into multi-worktree repos must pin the exact worktree path (see /repogolem's
brainlayer topology note).

Evidence: bl-pr-reviver#3 (local merge refused — 'main' used by brainlayer-prod);
codex-orqi-engine#10 (remote merge succeeded, branch survived cleanup);
codex-455#3 (same worker bitten twice); bl-orqi-codex#2 (unpinned worktree path).

### Stacked PR Branch-Delete Trap

If a child PR is based on the branch you are merging, deleting the base branch
can auto-close the child. Closed PRs cannot be retargeted (`Cannot change the
base branch of a closed pull request`; #456 needed replacement #462).
Safe order: merge base **without** `--delete-branch`, then immediately retarget
children. If squash artifacts conflict, rebase children with
`git rebase --onto origin/<target-branch> origin/<base-branch>` while the base
exists. Delete the base branch only after children are retargeted, rebased if
needed, and mergeable. For golems/master, `<target-branch>` is `master`.

### Post-Merge Verification

After every merge, verify the merge commit contains the changes from your latest
pushed SHA. For squash merges, this is content/tree verification, not ancestor
containment. Mid-review external merges can strand fixes (#475 merged without
`d6a292a`; recovered by cherry-pick #476).

Deployment/live claims are governed by canon #4 and the Deploy Truth Gate above.

### Merge Authority

Once the loop is clean — reviewers invoked, every CRITICAL/MAJOR/HIGH comment fixed-or-replied, CI green, self-QA gates passed (daemon gate + visual self-QA below where they trigger) — merge unless the dispatch says lead owns merge.

- **Single-GitHub-account reality:** `reviewDecision` can never reach APPROVED on
  EtanHey repos (self-approve is structurally blocked). A clean loop with bot
  reviews replied-to is the approval. Where branch protection blocks the merge,
  `--admin` after a clean loop is the standing policy — not a violation.
- **What this does NOT relax:** never merge with 0 reviews (bots count, invoke
  them); never merge with an unreplied CRITICAL, MAJOR, or HIGH finding (per the
  classification table above — MAJOR means fix immediately); never skip the
  daemon or visual gates where they trigger. Functional self-QA happens BEFORE
  handoff — "merged" ≠ "converged into one verified build."

### After Merge: Update Tracking (MANDATORY)

**Every merged PR MUST update its tracking. No exceptions.**

1. **Collab file** — If this PR is part of a collab, update the task board status to ✅ Done with PR number
2. **Roadmap** — If this PR completes a roadmap phase, update `$ORCHESTRATOR_REPO/roadmap/README.md`
3. **BrainLayer** — `brain_store` what changed and why (tagged `pr-merged`, `<project>`)

```
WRONG: Merge PR, exit silently               ← Tracking drift!
WRONG: "I'll update the collab later"         ← You won't. Do it NOW.
WRONG: Only update one of collab/roadmap/BL   ← Update ALL relevant trackers.
```

If you are an autonomous agent, this step is NON-NEGOTIABLE. The orchestrator should NEVER discover completed work by accident.

---

## Daemon Verification Gate

> [!CAUTION]
> NON-NEGOTIABLE HARD STOP: IF A PR TOUCHES DAEMON, SOCKET, MCP, OR PROTOCOL CODE, YOU MUST COMPLETE REAL CLIENT RUNTIME VERIFICATION BEFORE MERGE. MARKDOWN INTENT IS NOT ENOUGH.

**Triggers when:** PR touches daemon, socket, MCP, protocol, VoiceBar runtime, or any socket-based daemon code (BrainBar, VoiceBar, cmux MCP, VoiceLayer MCP daemon, `flow-bar/**`, `launchd/**`, `src/mcp-server*.ts`, `src/mcp-socket-owner.ts`, `src/socket-*.ts`, `src/daemon*.ts`, `src/paths.ts`, `src/process-lock.ts`, `src/resolve-binary.ts`, `src/whisper-server.ts`).

**socat/curl/unit tests are NOT sufficient.** Real client test required.

For VoiceLayer:

1. Run `./scripts/voicelayer-verify.sh` BEFORE `gh pr merge`.
2. If the script says runtime verification is required, rebuild/relaunch VoiceBar when prompted.
3. Press F5 in the real VoiceBar client, speak `verification test`, release, and confirm paste fired.
4. Confirm `.verified/verified-runtime-<branch>-<short-sha>.txt` exists and contains `Verified-Runtime: <sha>`.
5. Add the exact `Verified-Runtime: <sha>` line to the PR body.
6. Only then merge.

If you run `gh pr merge --admin` without the matching verify artifact, you violated the gate. `brain_store` the violation immediately as an `orc-correction` with what happened, why the hook/skill failed, and how to prevent recurrence.

For non-VoiceLayer daemon PRs:

1. Open a NEW cmux pane (`cmux new-split right`).
2. Launch a fresh Claude Code session in that pane.
3. Verify MCP tools are available AND return real results.
4. If tools are unavailable or return errors, the PR is NOT done.

**Why:** Real regressions passed markdown-only gates and shell smoke tests. Persistent clients, app focus, hotkeys, paste behavior, and MCP framing failures only show up in live sessions.

---

## Visual Self-QA Gate — builders click IN before merge (gen-10 weave #37, 2026-06-05)

**Triggers when:** the PR touches anything a human SEES — UI views, dashboards,
HTML pages, menu-bar apps (BrainBar/VoiceBar), Phoenix views, TUI surfaces.

**The rule:** the BUILDER clicks INTO a real running session and screenshots it
BEFORE merge. Mechanical checks (PID running, commit-matches, server responds)
are NOT a functional pass — "generated" ≠ "verified."

1. Run the real thing (deployed URL or live app — not the build directory).
2. Click into a REAL session/state, exercising the changed surface.
3. Screenshot (desktop + mobile where the surface is mobile-first) and attach the
   `/never-fabricate` R7 Verification Receipt to the PR/collab message.
4. **Route visual QA of menu-bar apps to Codex computer-use** — Codex has driven
   BrainBar before; Claude CU is weak there. Known gotcha: the `LSUIElement`
   grant dialog is a focus state, not a hard block (fallback: `screencapture`
   CLI + coordinate clicks).
5. Cannot screenshot? Then say so: "VISUAL VERIFICATION NOT PERFORMED — needs
   manual check before merge." Never claim a visual pass from text tools (R7).

---

## What NOT To Do

```
WRONG: gh pr create && gh pr merge --auto    ← No review!
WRONG: gh pr create && gh pr merge --merge   ← Same message, no review!
WRONG: "PR created, done!"                   ← Mission is MERGED, not created
WRONG: Skip review "because it's a small change" ← Small changes break things too
```

## Finishing a Branch (Alternative Endings)

Not every branch goes through the full PR flow. When implementation is done:

1. **Verify tests pass** before offering options
2. **Present options:**

| Option | When to Use | Commands |
|--------|-------------|----------|
| **Create PR** (default) | Most cases — full review loop | Continue with steps 7-11 above |
| **Merge locally** | Small team, already reviewed | `git checkout main && git merge <branch> && git branch -d <branch>` |
| **Keep as-is** | Need to park work | Just stop. Worktree preserved. |
| **Discard** | Wrong approach, start over | Requires typed "discard" confirmation. `git branch -D <branch>` |

**Worktree cleanup:** For options 1 (after merge), 3 (never), and 4 (after discard):
```bash
# Check if in worktree
git worktree list | grep $(git branch --show-current)
# If yes, after merging/discarding:
git worktree remove <worktree-path>
```

After `git worktree add`, read the file from the worktree path before editing.
Reads from the primary checkout or another worktree do not carry over.

When operating from a linked worktree, do not merge or cleanup from that
worktree. Move to the original checkout, run `gh pr merge`, verify the remote
merge SHA, delete the remote branch, then remove the worktree. This avoids the
local failure when `main` is checked out elsewhere and keeps cleanup from
deleting the session underneath you. If even the original checkout cannot hold
the default branch (bare-mirror-style hubs like brainlayer), use the
"Worktree-Locked Local Merge" remote fallback above.

---

## After Merge: Store Component Reasoning

For every NEW file > 50 lines or with non-obvious architecture decisions:

```
brain_store("New file: {path} ({lines} lines). Purpose: {why}. Key decisions: {list}. Alternatives considered: {list}.",
  tags=["component-reasoning", "{repo}", "pr-{N}"], importance=7)
```

Future sessions query this instead of opening files to understand design choices.

---

## Composability

This skill is referenced by:
- `/large-plan` — every phase goes through this loop
- CodeRabbit commit gate — step 5, this skill is the FULL loop
- Collab files — all autonomous work requires this loop

This skill references:
- [references/github-identity.md](references/github-identity.md) — the ratified signature/trailer
  convention for every GitHub write
- `/tdd-guard` — the PreToolUse hook enforcing step 2's edit limit; the failing-test-first law
  itself is AGENTS.md / global CLAUDE.md, not this hook
- `/never-fabricate` — step 4 (verify before claiming) and never claim review is green
  without reading it

Note: the CodeRabbit commit gate and `/coderabbit` receiving-side logic are inlined in Steps 5 and 8 respectively. pr-loop is self-contained.

## Quick Reference

```bash
# The whole loop in commands:
git checkout main && git pull
git checkout -b feat/my-feature
# ... implement with TDD ...
bun test  # or npm test
git add src/changed-file.ts tests/new-test.ts
git commit -m "feat: description

Co-Authored-By: golemsClaude running claude-opus-4.6 <noreply@anthropic.com>"
git push -u origin feat/my-feature
gh pr create --title "feat: description" --body-file pr-body.md  # body ends with the signature block
# WAIT for review (60-90s for bots, or run coderabbit:code-reviewer)
gh pr view <N> --comments  # READ the review
# Fix any real bugs, push again if needed
gh pr merge <N> --merge --delete-branch
git checkout main && git pull
```
