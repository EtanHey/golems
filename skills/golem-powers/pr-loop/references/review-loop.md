# PR review loop

Read this when selecting PR-stage reviewers, waiting for them, classifying feedback, replying, fixing, or requesting re-review.

## Step 8: REVIEW (The Critical Step)

**This is NOT optional. This is NOT "auto-merge."**

### NEVER Merge With 0 Reviews

```bash
# Check BEFORE merging — empty reviewDecision + no routed review verdict = nobody looked
gh pr view <N> --json reviewDecision,comments
```

**Review Wait Timer (ENFORCED):**
1. After invoking reviewers → wait per the [waiting policy](#waiting-policy-no-polling-turns): a T3
   watch wake, or one bounded check no sooner than **120 seconds** after invoking. Never a timed polling turn.
2. If that check shows no review → re-invoke reviewers explicitly once, then end the turn on the watch
3. Fifteen minutes with no response does not waive the review gate: a lead may merge only after at
   least one review and all required comment/review conditions pass; a worker hands off unmerged.

CLEAN status with no reviews ≠ approved. It means NOBODY LOOKED.

| Bot | Expected time | Notes |
|-----|--------------|-------|
| CodeRabbit | 2-5 min | Auto-reviews on push |
| Greptile | Needs OSS approval | Manual activation |
| Macroscope | Needs activation | Auto-reviews once installed |

**If `reviewDecision` is empty and no routed review verdict is on the PR for `headRefOid` → DO NOT MERGE.**

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
# Bot tiering (canon #9): full panel on core diffs only. Reviewer selection and counts:
# /agent-routing § Routing rules (SSOT).
# Full core panel (right after PR creation, filtered by 8a.0)
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@greptileai review"
gh pr comment <N> --body "@codex review"
```

**Bot tiering — Cursor Bugbot is OPT-IN, never a panel default (orc ruling, 2026-09-05).**
Canon #9 tiers the roster. Clause 4 of the origin ruling, verbatim: *"bot tiering — full 4-bot panel
only on daemon/engine/transport diffs, else CodeRabbit + one, one pass per bot, duplicate findings
answered once + dup-links."*
That quote is provenance. Today the bots are advisory and run after the inner loop, and who reviews
and how many come from `/agent-routing` § Routing rules (SSOT), which wins on conflict.

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

#### 8a.2 — The Cursor diff pass is READ-ONLY

A Cursor pass reports findings only; it never edits files or pushes to the PR branch.

Routing (who implements/reviews and model selection): see `/agent-routing` § Routing rules (SSOT).

```bash
# Read-only Cursor review — costs no Bugbot quota, needs no @mention
cursor-agent -p --output-format text \
  "Review this branch's diff against main for correctness bugs and security issues. \
   Report findings only. Do NOT edit, create, or delete any file."
```

- Because it spends no Bugbot quota, this pass is still available on a repo whose policy bans Bugbot
  (8a.0) and on a non-core diff where Bugbot is correctly off the panel.
- If the pass exhausts Cursor's shared quota through its own dispatch, report **that dispatch** as the
  cause — never the resulting `resource_exhausted` as an external finding (canon #3).

Bot-invocation comments are agent-authored PR comments, so the signature block
applies to them too — the `gh()` wrapper will append it automatically once it
ships; until then, sign them by hand like any other comment.

Reviewer roster reality can degrade. If Greptile is unavailable, Cursor/Bugbot
is billing-blocked, or CodeRabbit is rate-limited, do not burn dead mentions.
Use the routing pointer in Step 8a.2 to select a replacement reviewer, retain the
Macroscope + `cr review --plain` pre-commit checks (not a substitute for the routed
pair review), and document which reviewers were unavailable in the PR.

### For private repos (no bot reviewers):

Options A/B are PR-stage review run by whoever owns this PR loop. They do not authorize a worker to start its own inner-loop reviewer; that remains owned by `/agent-routing` § Review routing.

```bash
# Option A: Use coderabbit:code-reviewer subagent
Agent(subagent_type="coderabbit:code-reviewer", prompt="Review PR #N")

# Option B: Use cr CLI
coderabbit review --agent  # Codex env, bounded to ~3 minutes
```

### For public repos (bot reviewers configured):

Bot reviewers post on the PR. They are advisory: wait on CI and the routed review with the waiting
policy below, and on a bot only when it flags something important. A silent or rate-limited bot is
recorded as unavailable, never awaited.

### Waiting policy (no polling turns)

The rules this section lands, verbatim (Etan 2026-10-18, via orc collab):

> **No polling turns.** No collab-monitor wakes in Codex, and no "watch #410" loops. Use T3 completion notifications or a single bounded check. Mechanical polling or rebases go to gpt-6-luna.

> **Watching:** anything that must sit and watch (a PR, CI, a file) uses a cheap **gpt-6-luna sub-agent**, never a big-context Sol or lead session.

> Never wait on rate limits.

Why: the weekly Codex quota drained in under 24 h. Long-lived sessions re-sent ~1.5M tokens per turn,
and collab-monitor polling wakes alone cost 201M tokens across 729 turns (orc forensics, 2026-10-18 22:20).
Every wake is a full-context model turn. A watcher process waiting on GitHub is not.

Wait in this order. Take the first option that fits:

1. **T3 seat: parent-owned PR watch.** Once the PR exists, call `link_pull_request` with its URL, then
   `watch_pull_request`, and end the turn. T3 wakes you when checks finish, someone else comments, or
   the branch conflicts. The watch belongs to the seat that owns this PR loop. A delegated child never
   owns its parent's PR watch. Call `unwatch_pull_request` at a terminal state (merged, handed off,
   closed) before handing the thread back.
2. **Single bounded check.** When you need the state now (after a wake, or right before a merge
   decision), make one read: `gh pr checks <N>` or
   `gh pr view <N> --json state,mergeStateStatus,reviewDecision,headRefOid`. Act on it or end the turn.
   Never a second read inside a sleep loop.
3. **Something must sit and watch outside T3.** Use one cheap watcher, never a big-context lead
   session looping. Either:
   - a watcher process, `pr-watch <owner/repo> <N> --head <sha> --deadline 2h`, whose exit wakes you.
     Claude's native `Monitor` runs a command and spends no model turns while it waits. Details below.
   - one bounded `codex.subagent.mechanical` child (resolve it with
     `node scripts/model-roles.mjs codex.subagent.mechanical --use watcher`). Give it a deadline and
     the pinned head. It reports once, at a terminal state, and is settled after. It never merges.

   One watcher per PR head, whichever you pick.
4. **Banned:**
   - `ScheduleWakeup`, `CronCreate` or `/loop` polling turns for CI or reviews.
   - Codex collab-monitor wakes: a Codex seat never arms `/collab-monitor` or its packaged fallback.
   - `sleep N; gh pr view` loops and "watch #N" loops in a big-context lead session.
   - A duplicate watcher on the same PR: a T3 watch plus a `pr-watch`, or two `pr-watch` processes.
   - Waiting on bot rate limits. Review bots run after the inner loop and are advisory. Wait on a bot
     only when it flags something important. A rate-limited or silent bot is recorded as unavailable
     in the PR body, and the loop proceeds on the routed review.

#### Watcher process: pr-watch

Arm exactly one GitHub watch:
`Monitor(command="pr-watch <owner/repo> <N> --head <sha> --deadline 2h", timeout_ms=1800000)`.
Use `pr-watch` on PATH (installed in `~/.golems/bin`), or `scripts/pr-watch` from a golems checkout.
Codex runs the same command and reads its exit code, with `--deadline 25m` so the blocked turn stays
inside Codex's ~30-min cache window. The 2h deadline is Claude-only: it is safe there only because the
≤30-min Monitor expiry, not the deadline, bounds the wake. pr-watch never merges.
An empty rollup is never READY. Required contexts must be present and green,
and the default 180s settle window must stay quiet. See the
[exit-code table](../../../../scripts/pr-watch-lib/README.md#usage-and-exits).
Handle every terminal exit: 0 READY: proceed to the exact-head review and authorized merge path;
10 FAILED: fix the failure; on exit 11 HEAD_MOVED, read the new head and re-arm with that SHA;
12 MERGED: stop; on exit 20 DEADLINE: re-arm if waiting continues or escalate;
30 GH_ERROR: back off and report stderr.
The 30-minute Monitor expiry precedes the 2h --deadline; re-arm on expiry, since
re-arming restarts the deadline and the settle window. Cancel the old Monitor with TaskStop
before re-arming at expiry or after compaction. Never raise `timeout_ms` past 50 min (3000000) on a
Claude seat: a wake past the ~60-min cache window re-reads the whole context uncached (cache audit
2026-10-19). Each re-arm costs one model turn. If the wait will
need more than one, move it to the T3 watch or a bounded mechanical child instead. READY remains a CI
fact; read the exact-head review before an authorized merge. Never route Codex's output through a
cmuxlayer file watch.

#### cmux adapter (fallback: cmux fleets without T3)

Still the right tool where a cmux fleet has no T3 thread to wake. For addressed review handoffs, a
seat with native `Monitor` uses it; otherwise it uses `/collab-monitor`'s packaged fallback with an
attached consumer. Codex seats never arm it ("No collab-monitor wakes in Codex"):
their lead delivers the handoff into the pane. Query slim state/activity counts, then fetch full
review bodies once when they change. The bans above still apply: no ScheduleWakeup or CronCreate
polling turns for CI or reviews.

```bash
# Fetch after a review handoff or activity-count change
gh api --paginate repos/{owner}/{repo}/issues/{N}/comments
gh api --paginate repos/{owner}/{repo}/pulls/{N}/reviews
```

### Reading Review Comments

Fetch comments from all review sources with full context:

```bash
# Quick view of all comments
gh api --paginate repos/{owner}/{repo}/issues/{N}/comments
gh api --paginate repos/{owner}/{repo}/pulls/{N}/reviews

# Detailed: get review comments with diff context
gh api --paginate repos/{owner}/{repo}/pulls/{N}/comments
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
| Cursor (diff pass) | Diff findings through the Cursor subscription — spends no Bugbot quota | `cursor-agent -p --output-format text "…report findings only, do NOT edit any file"` — see routing pointer in Step 8a.2. |
| Cursor Bugbot | Bug detection — **opt-in, core paths only** | Not on the default panel (see Step 8a tiering) and never where repo policy bans it (Step 8a.0). On a daemon/engine/transport diff: `gh pr comment <N> --body "@cursor @bugbot review"`. Re-review after fixes: `gh pr comment <N> --body "@cursor @bugbot re-review"`. Bot responds as `cursor[bot]`. |
| Greptile | AI review + codebase understanding | Comment `@greptileai review`. Needs OSS activation. |
| DeepSource | Static analysis | DeepSource findings: use `deepsource-issues <owner/repo> <pr>`, or the `deepsource-io[bot]` inline comments via `gh api`. The token comes from `DEEPSOURCE_TOKEN` or the 0600 file `~/.config/deepsource/deepsource.env` (override: `DEEPSOURCE_TOKEN_FILE`). Never a browser, never op |

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

Max 2 review-fix rounds; round 3 requires a lead exception written in the PR body.

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

### Review Loop (one clean exact-head review may merge)

```
Round 1: Read review at headRefOid; required checks green + clean review may merge
Round 2: Only for BLOCKING findings; push fixes and request re-review
```

CodeRabbit auto-re-reviews on new pushes. For others, comment `@bot re-review` explicitly.
Round 3 requires a lead exception written in the PR body (canon #9). Never merge with open blocking issues.

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
# Wait on the routed re-review (waiting policy); bots re-run as advisory — CodeRabbit
# auto-triggers, others need a manual @mention
```

### Only THEN merge (clean review and required checks green at headRefOid):

```bash
# Verify reviews are actually in before merging
gh pr view <N> --json reviewDecision,comments

gh pr merge <N> --merge --delete-branch
git checkout main && git pull
```

### Visual review validity and round counting

Every visual PR reviewer must inspect and cite desktop before/after, 390 px
before/after, one GIF per animation/interaction (or the exact no-change exemption),
and e2e screenshot diffs from the PR's Visual proof section. A review that
cites only code is INVALID and does not count as a round, including Loop-record
inner/remote counts. Obtain a valid artifact-citing review before counting a
clean round or merging. Missing proof is a pre-merge stop at every PR size.
Routing: see `/agent-routing` § Routing rules (SSOT).
