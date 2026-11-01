# Cursor CLI — pr-loop Adapter

> Capability gaps for Cursor running the PR loop. Routing (who implements/reviews and model selection): see `/agent-routing` § Routing rules (SSOT).

## What Cursor CAN Do

| Step | Command | Notes |
|------|---------|-------|
| Branch | `git checkout -b feat/name` | Full git access |
| Implement | See routing pointer above | Select the implementing role there |
| Test | `bun test` or `npm test` | Shell access |
| Commit | `git add <files> && git commit` | No cr review pre-check |
| Push | `git push -u origin feat/name` | |
| PR | `gh pr create ...` | If `gh` is installed + authenticated |
| Read comments | `gh api --paginate repos/{owner}/{repo}/issues/{N}/comments`; `gh api --paginate repos/{owner}/{repo}/pulls/{N}/comments`; `gh api --paginate repos/{owner}/{repo}/pulls/{N}/reviews` | One bounded read per wake, never a poll loop |
| Merge | `gh pr merge <N> --merge --delete-branch` | |

## Critical Gaps

| Gap | Impact | Workaround |
|-----|--------|-----------|
| No `cr review` pre-commit check | Commits without CodeRabbit pre-screening | Run `cr review --plain` manually if cr installed |
| No `Agent()` tool | Can't spawn coderabbit:code-reviewer subagent | Use routed review handoffs |
| No native `Monitor` | Needs an attached watch consumer | T3 `watch_pull_request` first; else `pr-watch` with a pinned head and exit code for CI; `/collab-monitor` only under the cmux adapter |
| No BrainLayer MCP | Can't brain_store post-merge | Orchestrate from Claude session |
| No Cursor Bugbot auto-trigger | Cursor can comment via PR but not programmatically | Rarely needed — Bugbot is **opt-in, core paths only** ([review loop § 8a](../references/review-loop.md#step-8a-invoke-reviewers)) and banned outright by some repos' `AGENTS.md` (§ 8a.0). Where it genuinely applies, comment `@cursor @bugbot review` on GitHub by hand |

## CI and Review Waiting

Wait per the [waiting policy](../references/review-loop.md#waiting-policy-no-polling-turns), in order:
on a T3 seat, the owning parent links created/taken-over/pushed PRs immediately, handles feedback
and branch fixes/pushes, then calls `watch_pull_request`, inspects `watching:true` and ends.
Ordinary wakes/pushes preserve the watch; no routine list/rearm. Unwatch before terminal/handoff.
A child reports its artifact and ends. When state is needed now, one bounded read; only when
something must sit and watch outside T3, the single watcher process below.

Use `pr-watch` on PATH (installed in `~/.golems/bin`), or `scripts/pr-watch` from a golems checkout.

Outside T3 only, run exactly one `pr-watch <owner/repo> <N> --head <sha> --deadline 2h`
for GitHub CI and read its exit code. pr-watch never merges; an empty rollup is
never READY. Use the [exit-code table](../../../../scripts/pr-watch-lib/README.md#usage-and-exits)
and [shared arming rules](../references/review-loop.md#watcher-process-pr-watch).
No `ScheduleWakeup`, `CronCreate` or `/loop` polling turns for CI or reviews, and never wait on a
rate-limited bot.

In a cmux fleet without T3, addressed review handoffs follow the
[cmux adapter](../references/review-loop.md#cmux-adapter-fallback-cmux-fleets-without-t3): the
`/collab-monitor` packaged fallback with an attached consumer, re-armed at its 30-minute expiry and
after compaction. Query slim state/activity counts and fetch full review bodies only when those change.

## Cursor's Unique Advantage in the Loop

Cursor exposes `@codebase` indexing. The diff pass is read-only (review loop § 8a.2).
For role ownership, use the routing pointer above;
for the diff-pass procedure, see [review loop § 8a.2](../references/review-loop.md#8a2--the-cursor-diff-pass-is-read-only).

```bash
# Read-only pre-PR audit — report only, zero Bugbot quota
cursor-agent -p --output-format text \
  "Audit the staged changes for bugs and security issues. @codebase \
   Report findings only. Do NOT edit, create, or delete any file."
```

If this pass exhausts the shared quota, report the dispatch as the cause, not
the resulting `resource_exhausted` as an external finding (canon #3).

Cursor **Bugbot** is a different thing and is **not** part of this pass: it is opt-in, core paths only
(daemon/engine/transport diffs), and off entirely where the target repo's `AGENTS.md` bans it — read
that policy first ([review loop § 8a.0](../references/review-loop.md#8a0--read-the-target-repos-bot-policy-before-summoning-anything)). On a non-core diff, do not summon it at all.

## Agent Identity Signature — Cursor (ratified 2026-08-08) — OPEN GAP

Convention + failure modes: [../references/github-identity.md](../references/github-identity.md).
`harness` is `cursor`. Seat and role come from launcher env as usual.

**Live-model capture is UNRESOLVED for Cursor.** Checked 2026-08-08: `~/.cursor/chats` held no
per-turn records on this machine, and no verified live-model source exists for the Cursor CLI the
way Claude (`.message.model` in `~/.claude/projects/**.jsonl`) and Codex (`turn_context.model` in
`~/.codex/sessions/**/rollout-*.jsonl`) do.

Until a source is verified, use `🤖 Generated with unknown in Cursor`.
Never substitute launch flags, spawn-registry values or self-report.
Use the same plain line on every repo. Keep the commit trailer from the identity reference.
Use `--body-file` or stdin to preserve literal text.

Observed effort is allowed only on the Loop-record line.

## Hierarchical Worker Mode

For worker endpoints, draft handling, and head verification, read
[dispatch and handoffs](../references/dispatch-and-handoffs.md).

## Recommended Usage

Use the routing pointer above to select roles for the loop.
Post-merge BrainLayer updates require a BrainLayer-capable session.
