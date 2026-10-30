# Codex CLI — pr-loop Adapter

> Capability gaps for Codex running the PR loop. Codex can handle git/gh ops and shell-trigger GitHub reviews, but it lacks native review tooling and BrainLayer access.

## What Codex CAN Do

| Step | Command | Notes |
|------|---------|-------|
| Branch | `git checkout -b feat/name` | Full git access |
| Implement | File edits in full-auto mode | Core strength |
| Test | `bun test` or `npm test` | Shell access |
| Commit | `git add <files> && git commit` | No cr review pre-check |
| Push | `git push -u origin feat/name` | |
| PR | `gh pr create ...` | If `gh` is installed + authenticated |
| Trigger review bots | `gh pr comment <N> --body "@codex review"` | Shell path, not a native reviewer tool |
| Trigger Bugbot | `gh pr comment <N> --body "@cursor @bugbot review"` | **Opt-in, core paths only** ([review loop § 8a](../references/review-loop.md#step-8a-invoke-reviewers)) and never where the repo's `AGENTS.md` bans it (§ 8a.0). Not part of the default panel. Re-review with `@cursor @bugbot re-review` |
| Read comments | `gh api --paginate repos/{owner}/{repo}/issues/{N}/comments`; `gh api --paginate repos/{owner}/{repo}/pulls/{N}/comments`; `gh api --paginate repos/{owner}/{repo}/pulls/{N}/reviews` | Fetch once on a wake that shows a change — never in a poll loop |
| Merge | `gh pr merge <N> --merge --delete-branch` | See worktree note below |

## Critical Gaps

| Gap | Impact | Workaround |
|-----|--------|-----------|
| No `cr review` pre-commit check | Commits without CodeRabbit pre-screening | Run `cr review --plain` manually if cr is installed |
| No `Agent()` tool | Can't spawn coderabbit:code-reviewer subagent | One bounded slim read per wake (see CI + Review Waiting below) |
| No native `Monitor` | A watch must not be a model loop in this session | T3 `watch_pull_request` and delegate completion wakes first; else one pinned-head `pr-watch` process for CI. No collab-monitor wakes |
| No BrainLayer MCP | Can't brain_store post-merge | Skip or orchestrate from Claude session |
| No native review-bot tool | Can't invoke Codex Cloud or Cursor Bugbot through a built-in agent tool | Use `gh pr comment` shell commands after the PR opens, filtered by the repo's bot policy |
| No `AGENTS.md` bot-policy check in the loop | Can summon a bot the target repo bans | Read the target repo's `AGENTS.md` PR-workflow section BEFORE the first `@mention` ([review loop § 8a.0](../references/review-loop.md#8a0--read-the-target-repos-bot-policy-before-summoning-anything)), and name the applied policy in the PR body |

## Worktree Merge Mechanics

When Codex is operating inside a linked worktree, never merge from that active
worktree. Move to the original checkout, run `gh pr merge`, verify the remote
merge SHA, delete the remote branch, then remove the worktree so cleanup does
not delete the session underneath you. End the merge comment or DONE report with
the [CLEANUP RECEIPT](../references/merge-and-verification.md#cleanup-receipt).

## Shell Review Triggers (Codex fallback)

Read the target repo's bot policy first — repo law tightens the fleet default panel, never loosens it
([review loop § 8a.0](../references/review-loop.md#8a0--read-the-target-repos-bot-policy-before-summoning-anything)):

```bash
sed -n '/## PR Workflow/,/^## /p' AGENTS.md 2>/dev/null
grep -n -i 'bugbot\|greptile\|coderabbit\|codex review\|do not route' AGENTS.md CLAUDE.md 2>/dev/null
```

```bash
# Trigger the standard review stack from a Codex session (subject to that policy)
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"

# After pushing fixes, request another pass from the reviewers you actually invoked
gh pr comment <N> --body "@coderabbitai review"
gh pr comment <N> --body "@codex review"
```

**Bugbot is not on this list.** It is opt-in on core paths only — a daemon, engine, or transport diff
— and stays off entirely on docs/skills/tests/config diffs and in any repo whose `AGENTS.md` bans it
(e.g. brainlayer: *"do not route mandatory reviews to Bugbot or Greptile"*). Where it does apply:

```bash
gh pr comment <N> --body "@cursor @bugbot review"      # core paths ONLY — opt-in
gh pr comment <N> --body "@cursor @bugbot re-review"   # only if Bugbot reviewed round 1
```

Routing (who implements/reviews and model selection): see `/agent-routing` § Routing rules (SSOT).
Diff-pass procedure: [review loop § 8a.2](../references/review-loop.md#8a2--the-cursor-diff-pass-is-read-only).

## CI + Review Waiting (Codex — NO sleep-poll loops)

Wait per the [waiting policy](../references/review-loop.md#waiting-policy-no-polling-turns), in order:

1. **T3 seat:** owning parent links created/taken-over/pushed PRs immediately, handles existing
   feedback and branch fixes/pushes, then calls `watch_pull_request`, inspects `watching:true` and ends.
   Ordinary wakes/pushes preserve the watch; no routine list/rearm. Unwatch before terminal/handoff.
   A delegated child reports its artifact and ends; it never watches or substitutes a process/child.
2. **State needed now:** one bounded slim read (below), then act or end the turn.
3. **Must sit and watch outside T3:** one pinned-head `pr-watch` process, or one bounded
   `codex.subagent.mechanical` child that reports once at a terminal state. Never this session
   looping.

Sleep-poll loops that re-fetch the full PR payload are BANNED. Cost evidence
(weave 2026-06-07, 3 instances across 2 sessions): `sleep 60; gh pr view <N>
--json ...,comments,reviews,latestReviews,...` loops burned ~47M cumulative
input tokens and forced mid-task auto-compactions — every cycle re-ingests the
entire comment/review payload into context.

Use `pr-watch` on PATH (installed in `~/.golems/bin`), or `scripts/pr-watch` from a golems checkout.

```bash
# Outside T3 only, CI: ONE blocking call — read its exit code. 25m, not Claude's 2h: Codex has no shorter Monitor
# expiry, so the deadline itself keeps the wake inside Codex's ~30-min cache window
pr-watch <owner/repo> <N> --head <sha> --deadline 25m

# Review state: one bounded slim read per wake — state fields + activity COUNTS, never full bodies
gh pr view <N> --json state,mergeStateStatus,reviewDecision
gh pr view <N> --json comments,reviews \
  --jq '{comments: (.comments|length), reviews: (.reviews|length)}'

# Full payload: fetch ONCE, only AFTER the slim read shows a change
gh pr view <N> --json comments,reviews,latestReviews
```

Rules:
- Outside T3 only, CI waiting is one pinned-head pr-watch command. Read the
  [exit-code table](../../../../scripts/pr-watch-lib/README.md#usage-and-exits):
  0 READY is a CI fact, 12 MERGED is an observed merge, 10 FAILED needs action,
  11 HEAD_MOVED needs a new head pin, 20 DEADLINE needs re-arming if waiting
  continues, and 30 GH_ERROR needs the stderr diagnosis. The 25-minute deadline
  is the Codex cache limit (≤25 min per wake): if CI needs longer, prefer the
  event wake (T3 `watch_pull_request`, a delegate completion) over repeated
  re-arms. pr-watch never merges;
  an empty rollup is never READY. Keep required contexts and the 180s default
  settle window. Do not route its output through a cmuxlayer file watch.
- On each wake (T3 watch, delegate completion, pr-watch exit), read only the slim state fields plus the
  comment/review COUNTS (`--jq '... length'` — only the numbers enter
  context). Counts are the trigger that catches bot reviewers (CodeRabbit,
  Codex, Bugbot) whose findings land as comments WITHOUT changing
  `reviewDecision` — which stays empty on self-account repos.
- Fetch full `comments,reviews,latestReviews` exactly once, when a state
  field changes or a count increases — never inside a poll cycle.

Review handoffs reach this seat as T3 wakes: a `delegate_task` completion, or the parent-owned
`watch_pull_request` wake. Never arm `/collab-monitor` or its packaged fallback for a review handoff,
in T3 or in cmux. The rule, verbatim (Etan 2026-10-18, via orc collab): "No polling turns. No
collab-monitor wakes in Codex, and no "watch #410" loops. Use T3 completion notifications or a single
bounded check." Outside T3 only, mechanical PR watching goes to one bounded `codex.subagent.mechanical` child (policy
item 3). No `ScheduleWakeup`/cron wakes for CI or reviews, and never wait on a rate-limited bot: bots
are advisory.

## Agent Identity Signature — Codex read paths (ratified 2026-08-08)

Convention + failure modes: [../references/github-identity.md](../references/github-identity.md).
`harness` is `codex`. Codex has the **best** live-model record of the three harnesses: every
`turn_context` in the rollout JSONL carries the model actually in use for that turn.

```bash
# Rollout JSONL for the current session
ROLL=$(ls -t ~/.codex/sessions/*/*/*/rollout-*.jsonl | head -1)

# model — LAST turn_context wins (verified keys on turn_context: model, effort, turn_id, cwd, …)
MODEL=$(jq -r 'select(.payload.type=="turn_context") | .payload.model' "$ROLL" | tail -1)  # e.g. gpt-5.6-sol

# session id — the uuid in the rollout filename
SESSION=$(basename "$ROLL" | sed -E 's/.*-([0-9a-f-]{36})\.jsonl/\1/' | cut -c1-8)

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

- Take the LAST `turn_context`, not the first: a model switch writes a new record.
- Never substitute model self-report or spawn settings.
- Unreadable rollout: use `unknown`.
- No effort in the signature or commit trailer; observed effort belongs only in Loop-record.

Sign with `--body-file` or stdin to preserve literal body text.

Observed effort is allowed only on the Loop-record line.

## Hierarchical Worker Mode

For worker endpoints, draft handling, head verification, and deploy claims, read
[dispatch and handoffs](../references/dispatch-and-handoffs.md) and
[merge and verification](../references/merge-and-verification.md).

## Recommended Usage

Use Codex for pr-loop ONLY when:
- Shell-driven review triggers and T3 wakes (or one pinned-head pr-watch) are acceptable
- A Claude session can handle post-merge BrainLayer updates
- `gh` CLI is installed and authenticated in the environment

**Loop mechanics:** Open the PR, trigger review bots through `gh`, wait on the T3 watch (or one pinned-head pr-watch command, reading its exit code), and read slim review state once per wake. Use the routing pointer above for role ownership and a BrainLayer-capable session for post-merge tracking.
