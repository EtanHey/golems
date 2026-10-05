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
| Read comments | `gh pr view <N> --comments` | Manual poll only |
| Merge | `gh pr merge <N> --merge --delete-branch` | |

## Critical Gaps

| Gap | Impact | Workaround |
|-----|--------|-----------|
| No `cr review` pre-commit check | Commits without CodeRabbit pre-screening | Run `cr review --plain` manually if cr installed |
| No `Agent()` tool | Can't spawn coderabbit:code-reviewer subagent | Use routed review handoffs |
| No native `Monitor` | Needs an attached watch consumer | `/collab-monitor` packaged fallback for handoffs; `gh pr checks <N> --watch` for CI |
| No BrainLayer MCP | Can't brain_store post-merge | Orchestrate from Claude session |
| No Cursor Bugbot auto-trigger | Cursor can comment via PR but not programmatically | Rarely needed — Bugbot is **opt-in, core paths only** ([review loop § 8a](../references/review-loop.md#step-8a-invoke-reviewers)) and banned outright by some repos' `AGENTS.md` (§ 8a.0). Where it genuinely applies, comment `@cursor @bugbot review` on GitHub by hand |

## CI and Review Waiting

Use one `gh pr checks <N> --watch` call for CI completion. For addressed review
handoffs, use the `/collab-monitor` packaged fallback with an attached consumer;
re-arm at its 30-minute expiry and after compaction. Query slim state/activity
counts and fetch full review bodies only when those change. Timed one-shot
wakes follow `collab-monitor/references/cron-payloads.md` and the current schema.

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

Until a source is verified:

```
"model":"unknown","model_source":"unavailable"
```

- **Do NOT substitute the launcher's `-m` flag or spawn-registry value.** That is exactly the
  boot-time/spawn-registry provenance the ratification banned ("the gh() wrapper must re-read model
  per invocation, not cache at spawn"; cmux spawn metadata is the `xhigh`-lie surface).
- **Do NOT substitute self-report.** Cursor routes to multiple upstream models; the model's belief
  about itself is not evidence; see `/agent-routing` `references/model-and-effort.md` § Dispatch and Verification.
- An honest `unknown` is the correct output. It tells a later audit "this row has no model", which
  is true — rather than fabricating one, which is the failure the convention exists to prevent.
- If you find a verified per-turn model record for the Cursor CLI, that is a real finding: report it
  so this adapter and the `gh()` wrapper can be updated (golems / repoGolem lane owns the wrapper).

Everything else in the convention applies unchanged: visible line + one-line blob last in the body,
ownership marker on non-`EtanHey` repos, no `effort` field anywhere, and the commit trailer
`Co-Authored-By: <seat> running <model> <noreply@anthropic.com>` (with `unknown` where the model is
genuinely unavailable). Use `--body-file`, not inline `--body`, so the blob survives shell quoting.

## Hierarchical Worker Mode

For worker endpoints, draft handling, and head verification, read
[dispatch and handoffs](../references/dispatch-and-handoffs.md).

## Recommended Usage

Use the routing pointer above to select roles for the loop.
Post-merge BrainLayer updates require a BrainLayer-capable session.
