# PR review loop

Read this when selecting PR-stage reviewers, waiting for them, classifying feedback, replying, fixing, or requesting re-review.

## Step 8: REVIEW (The Critical Step)

**This is NOT optional. This is NOT "auto-merge."**

### NEVER Merge With 0 Reviews

```bash
# Check BEFORE merging — empty reviewDecision + no routed review verdict = nobody looked
gh pr view <N> --json reviewDecision,comments
```

**Review evidence:** follow the [waiting policy](#waiting-policy-no-polling-turns).
Use the native T3 watch for pending CI/reviews; make bounded reads when a current decision needs them.
Missing review evidence still blocks merge, regardless of elapsed time. Do not send another bot
request when an eligible automatic review already covers the current head.

CLEAN status with no reviews ≠ approved. It means NOBODY LOOKED.

| Bot | Expected time | Notes |
|-----|--------------|-------|
| CodeRabbit | 2-5 min | Auto-reviews on push |
| Greptile | Needs OSS approval | Manual activation |
| Macroscope | Needs activation | Auto-reviews once installed |

**If `reviewDecision` is empty and no routed review verdict is on the PR for `headRefOid` → DO NOT MERGE.**

### Step 8a: Invoke Reviewers

Finish the other-vendor inner review before opening a ready PR, then apply the permitted bot policy.
Request a bot manually only when required evidence is missing or stale and no eligible automatic
review already covers the current head; do not duplicate that review.

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
# Eligible core panel only (8a.0); omit bots already reviewing the current head
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

**The owning lead holds the watch.** In T3, the parent lead owns its PR watch, never the worker.
A worker arms no watch; its READY hands the PR to the lead. On accepting READY or a monitoring
request, handle existing feedback and finish branch fixes and pushes before arming the watch;
inspect its `watching:true` receipt and end the turn. An existing watch persists.

**Watching is not waiting: check your open PRs before every turn ends.** This is the owning
lead's duty, never a worker's: a worker reports and hands off its PR. Before ending ANY turn, the
lead reads the current state of every open PR it owns (ones it opened, adopted or was handed;
keep that list in your own notes), with one bounded `gh pr view <N> --json
state,isDraft,mergeStateStatus,statusCheckRollup` per PR. "Waiting" is never a state for a red or
green PR you own (Etan, 2026-11-01). Take the first case that applies:
- Visibly held, and the reason still holds: leave it.
- Red or conflicting: fix it now or route the fix now.
- Green: merge it under your lane's merge law.
- Behind: update the branch yourself whenever GitHub offers it.
- Checks or the routed review still running: keep the watch and end the turn. That is ordinary
  waiting, not a hold.
- Otherwise, if you are deliberately not moving it: hold it visibly (below).

**Ownership outlives the thread.** A PR stays yours until it merges, closes, or you hand it off.
- **Before settling, completing or retiring a lead thread** (yours, or one you settle for someone
  else), find its open PRs. For each one, call `watch_pull_request` with the PR and the successor
  lead's `threadId`, and check that call's `watching:true` receipt. Then tell the successor, and
  only after that unwatch it on the old thread (name that thread). Or close the PR. Settling drops
  the old thread's watches. A registered watch on the successor is not proof that it accepted the
  work: its acknowledgement is.
- **Adopt worker and bot PRs.** When a child, worker or bot (such as dependabot) opens a PR, the
  repo's lead links and watches it in the turn it learns of it.

**Held is visible, never silent.** A PR you are deliberately not moving yet is a draft and carries
a comment that starts `**Held on purpose`. The comment says, in plain words, why it is held, the
next step with its trigger, and the owner. Post a new one when the head moves. A wake on a held PR
needs no action unless the reason is gone. When it is gone, mark the PR ready, get the current-head
checks and the routed review, then apply merge law. Never merge a held draft. A red or green PR
that is not visibly held is unnoticed, whatever you intended.

**Watch claims need evidence.** Cite the same-turn `watch_pull_request` receipt with
`watching:true` to establish stored registration at that instant, not polling liveness, wake delivery, current CI or merge readiness.
A remembered or intended watch is not evidence. Never call `list_thread_pull_requests` solely to reprove a watch or end work; the end-of-turn check above uses `gh` reads.
Use it only for actual inventory (such as a settle handoff), diagnosis, an ambiguous receipt or an audit; its snapshots are not fresh host readiness.
If the receipt is false or ambiguous, report that state and diagnose it; do not claim the watch stuck.

**Wakes and pushes preserve the watch.** On ordinary wakes, no routine rewatch, relink, list or rearm.
A push still requires immediate linking under the harness contract, but does not require another watch.
A documented stop is distinct: close/merge, User Stop, settle/archive, repeated read failures or the
comment-only wake limit can stop monitoring. A new monitoring request after a documented stop can
rearm an eligible parent; never automatically undo User Stop or settle/archive. A normal wake is not a stop.

**Act on both PR-watch outcomes.** Red checks or conflicts mean fix now or route the fix now.
For green, verify current required checks and the routed review at the exact latest head before an
authorized merge; a completed notification is not approval. If blocked, report BLOCKED with a named blocker
and next owner, mark the PR held (above), then hand off when appropriate. Always unwatch before handback or terminal completion.
Do not leave ready work idle behind another PR's red checks.

**Every wait needs an owned wake source.** Name the event and its owner before ending as WAITING.
The T3 parent-owned native watch takes precedence over cheap watcher and timer prescriptions:
no timer wake, Monitor, scheduled PR poll or watcher child for T3 PR waiting. A blocker handoff is a
valid endpoint without scheduling another PR check. For non-PR owned waits, retain a real completion
or lane event; if none covers the wait, use one owned one-shot wake with its id/time recorded.
Snooze alone, including `snoozedUntil`, is not wake evidence. Do not promise delivery from registration.

**Offline hygiene check (diagnostic only).** `node scripts/ci/pr-wait-hygiene.mjs <snapshot.json|->`
is a diagnostic snapshot tool (pass 0, violations 1, invalid input 2), not a live watch verifier.
It retains its older open-PR contract: watching or BLOCKED-with-wake. A correctly handed-off blocked
PR can therefore fail it; report that contract mismatch. A checker failure never authorizes a timer, duplicate watcher or runtime override.
Only capture lists/task state for an actual audit or diagnosis allowed by T3's completion policy,
never as a routine end-of-turn ritual. The checker accepts one thread, `{ "threads": [...] }` or
`weave-t3-fleet/v1`; explicit workers/children are skipped. Preserve native `pullRequests` rows on their
owner, schedules in `schedules`, and task/child parent associations. Snooze does not count.
Snapshot fields, freshness and supplied events do not establish reactor liveness or wake delivery.

Historical fallback rules, verbatim (Etan 2026-10-18, via orc collab); the T3 native watch above
takes precedence for T3 PRs. The cheap-watcher prescription applies outside T3:

> **No polling turns.** No collab-monitor wakes in Codex, and no "watch #410" loops. Use T3 completion notifications or a single bounded check. Mechanical polling or rebases go to gpt-6-luna.

> **Watching:** anything that must sit and watch (a PR, CI, a file) uses a cheap **gpt-6-luna sub-agent**, never a big-context Sol or lead session.

> Never wait on rate limits.

Why: the weekly Codex quota drained in under 24 h. Long-lived sessions re-sent ~1.5M tokens per turn,
and collab-monitor polling wakes alone cost 201M tokens across 729 turns (orc forensics, 2026-10-18 22:20).
Every wake is a full-context model turn. A watcher process waiting on GitHub is not.

Wait in this order. Take the first option that fits:

1. **T3 seat: parent-owned PR watch.** Immediately `link_pull_request` each PR created, taken over
   or pushed, including every stack layer. Finish existing feedback and branch updates/pushes, then
   `watch_pull_request`; inspect the receipt and end the turn. On ordinary wakes act on the news,
   make only the bounded current-host/head reads needed for a decision, then end the turn if waiting
   continues. No routine rearm or extra watcher; the parent retains ownership.
   Call `unwatch_pull_request` at terminal state or before handoff. A child reports its artifact and ends its turn; it never watches.
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

   Reuse one existing watcher per PR with its current deadline and pinned head; never add a second.
   Replace only on the documented exit/expiry path below, cancelling the old watcher first.
4. **Banned:**
   - `schedule_task`, `ScheduleWakeup`, `CronCreate` or `/loop` polling turns for CI or reviews.
   - Codex collab-monitor wakes: a Codex seat never arms `/collab-monitor` or its packaged fallback.
   - `sleep N; gh pr view` loops and "watch #N" loops in a big-context lead session.
   - A duplicate watcher on the same PR: a T3 watch plus a `pr-watch`, or two `pr-watch` processes.
   - Waiting on bot rate limits. Review bots run after the inner loop and are advisory. Wait on a bot
     only when it flags something important. A rate-limited or silent bot is recorded as unavailable
     in the PR body, and the loop proceeds on the routed review.

#### Watcher process: pr-watch

Outside T3 only, arm exactly one GitHub watch:
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

**After fixing review feedback, obtain current-head re-review without duplicate requests:**

```bash
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@cursor @bugbot re-review"   # only if Bugbot reviewed round 1
```

Request re-review only for reviewers actually invoked whose current-head automatic review is
missing or stale. A bot that was correctly left off the panel — by repo
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

Automatic re-review depends on effective bot settings; manually request only missing/stale
current-head coverage from eligible reviewers.
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
# Routed re-review follows the waiting policy; bots are advisory.
# Effective settings determine automatic coverage; request manually only if missing/stale
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
