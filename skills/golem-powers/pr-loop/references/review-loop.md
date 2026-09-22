# PR review loop

Read this when selecting PR-stage reviewers, waiting for them, classifying feedback, replying, fixing, or requesting re-review.

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
4. Fifteen minutes with no response does not waive the review gate: a lead may merge only after at
   least one review and all required comment/review conditions pass; a worker hands off unmerged.

CLEAN status with no reviews ≠ approved. It means NOBODY LOOKED.

| Bot | Expected time | Notes |
|-----|--------------|-------|
| CodeRabbit | 2-5 min | Auto-reviews on push |
| Greptile | Needs OSS approval | Manual activation |
| Macroscope | Needs activation | Auto-reviews once installed |

**If `reviewDecision` is empty and `comments < 2` → DO NOT MERGE.**

### Step 8a: Invoke Reviewers

Always explicitly request reviews. Don't wait for auto-detection.

#### 8a.0 — Read the target repo's bot policy BEFORE summoning anything

The panel below is the **fleet default**. A repo's own `AGENTS.md` (or `CLAUDE.md` where there is no
`AGENTS.md`) may tighten it, and **repo law wins** — canon: repo law tightens, never loosens. Skipping
this read is how a worker summons a bot into a repo that bans it.

```bash
# In the TARGET repo, read the review/bot policy before the first @mention
sed -n '/## PR Workflow/,/^## /p' AGENTS.md 2>/dev/null
grep -n -i 'bugbot\|greptile\|coderabbit\|codex review\|do not route' AGENTS.md CLAUDE.md 2>/dev/null
```

1. **Read** the policy — the PR-workflow / review section of the target repo's `AGENTS.md`, falling
   back to `CLAUDE.md`.
2. **Summon only what it allows.** A bot the repo bans is not summoned — not at round 1, and not at
   re-review — even when the fleet default panel below lists it.
3. **Say which policy you applied** in the PR body, one line naming the file you read and what it
   excluded. Examples:
   - `Bot policy: brainlayer AGENTS.md ("do not route mandatory reviews to Bugbot or Greptile") → panel = CodeRabbit + Codex.`
   - `Bot policy: no bot clause in AGENTS.md → fleet default panel.`

Live conflict this clause exists for: `EtanHey/brainlayer`'s `AGENTS.md` says *"Do not route mandatory
reviews to Bugbot or Greptile."* On a brainlayer PR the `@greptileai review` line below is dropped and
Bugbot stays off regardless of core-path tiering. Origin: brainlayer lead escalation 2026-09-03 — a
worker followed this skill verbatim and summoned Bugbot into the repo that bans it
(`orchestrator/backlog/golems.md` #21).

#### 8a.1 — The panel

```bash
# The default panel (do this right after PR creation, filtered by 8a.0)
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@greptileai review"
gh pr comment <N> --body "@codex review"
```

**Bot tiering — Cursor Bugbot is OPT-IN, never a panel default (orc ruling, 2026-09-05).**
Canon #9 tiers the roster. Clause 4 of the origin ruling, verbatim: *"bot tiering — full 4-bot panel
only on daemon/engine/transport diffs, else CodeRabbit + one, one pass per bot, duplicate findings
answered once + dup-links."*

**Core = a daemon, engine, or transport diff.** No canonical path glob exists for this — the prose
phrase is the whole definition, so judge the diff rather than pattern-match a list. On a core-path
diff, add Bugbot to the panel:

```bash
gh pr comment <N> --body "@cursor @bugbot review"   # core paths ONLY — opt-in
```

On a **non-core** diff — docs, skills, briefs, tests, config — do not summon Bugbot at all.
Trigger: Bugbot answered `usage limit reached` on skill-creator #51, a non-core diff, 2026-09-05.

> **Provenance:** this is *orc's* ruling, not an Etan ratification. Orc took it rather than ask Etan
> to raise Cursor's cap, and offered him the reversal; no ratification or objection is on record.
> If the cap is raised, this tiering is the clause to revisit.

#### 8a.2 — The Cursor review pass is READ-ONLY

When the loop wants Cursor's eyes on a diff, that is a `cursor-workflows` / `cursor-agent -p` **review**
pass — never a write pass, never an implementation pass. Cursor gathers and verifies; Codex implements
(canon #1). A Cursor pass that edits files inside the PR loop is a routing violation, not a shortcut.

```bash
# Read-only Cursor review — costs no Bugbot quota, needs no @mention
cursor-agent -p --output-format text \
  "Review this branch's diff against main for correctness bugs and security issues. \
   Report findings only. Do NOT edit, create, or delete any file."
```

- **Auto-only, no model flag** (canon #1): never pass `-m`/`--model` or a model field — pinned Cursor
  drains the shared subscription pool fast.
- Because it spends no Bugbot quota, this pass is still available on a repo whose policy bans Bugbot
  (8a.0) and on a non-core diff where Bugbot is correctly off the panel.
- If the pass exhausts Cursor's shared quota through its own dispatch, report **that dispatch** as the
  cause — never the resulting `resource_exhausted` as an external finding (canon #3).

Bot-invocation comments are agent-authored PR comments, so the signature block
applies to them too — the `gh()` wrapper will append it automatically once it
ships; until then, sign them by hand like any other comment.

Reviewer roster reality can degrade. If Greptile is unavailable, Cursor/Bugbot
is billing-blocked, or CodeRabbit is rate-limited, do not burn dead mentions.
Use Codex + Macroscope + `cr review --plain` before commit within this PR loop
(not a substitute for the routed pair review), and document which reviewers were unavailable in the PR.

### For private repos (no bot reviewers):

Options A/B are PR-stage review run by whoever owns this PR loop. They do not authorize a worker to start its own inner-loop reviewer; that remains owned by `/agent-routing` § Review routing.

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
| Cursor (read-only pass) | Diff review through the Cursor subscription — spends no Bugbot quota | `cursor-agent -p --output-format text "…report findings only, do NOT edit any file"` — Auto-only, never a write pass (Step 8a.2). |
| Cursor Bugbot | Bug detection — **opt-in, core paths only** | Not on the default panel (see Step 8a tiering) and never where repo policy bans it (Step 8a.0). On a daemon/engine/transport diff: `gh pr comment <N> --body "@cursor @bugbot review"`. Re-review after fixes: `gh pr comment <N> --body "@cursor @bugbot re-review"`. Bot responds as `cursor[bot]`. |
| Greptile | AI review + codebase understanding | Comment `@greptileai review`. Needs OSS activation. |
| DeepSource | Static analysis | Check via CI status |

**After fixing review feedback, trigger re-review on every reviewer:**

```bash
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@cursor @bugbot re-review"   # only if Bugbot reviewed round 1
```

Re-review the reviewers you actually invoked. A bot that was correctly left off the panel — by repo
policy (8a.0) or by non-core tiering (8a.1) — does not get summoned at round 2 either.

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
