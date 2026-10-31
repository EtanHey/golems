# Claude Code — pr-loop Adapter

> Claude-specific syntax for running the full PR loop.

## Full Capabilities

Claude Code has everything needed for the complete loop:

| Step | Tool / Command | Notes |
|------|---------------|-------|
| Branch | `git checkout -b feat/name` via Bash | Full git access |
| Implement | Edit/Write tools + cheapest real proof | See the proof rule in `/pr-loop` |
| Test | `bun test` via Bash | Full shell access |
| Commit | `cr review --plain`, then `git commit` | CodeRabbit CLI available |
| Push | `git push -u origin feat/name` | |
| PR | `gh pr create` via Bash | `gh` CLI available |
| Review | `Agent(subagent_type="coderabbit:code-reviewer")` | Subagent spawning |
| Wait | T3: `link_pull_request` + `watch_pull_request`, end the turn. Else one native `Monitor` on `pr-watch` | [Waiting policy](../references/review-loop.md#waiting-policy-no-polling-turns); never a polling turn |
| Fix + merge | `gh pr merge <N> --merge --delete-branch` | |
| Post-merge | `brain_store(...)` via BrainLayer MCP | MCP access |

## Review Polling Options (Claude-specific)

These options are PR-stage review run by whoever owns the PR loop; who reviews before the PR is owned by `/agent-routing` § Review routing, and a worker never starts its own reviewer.

```bash
# Option A — subagent reviewer (best)
Agent(subagent_type="coderabbit:code-reviewer", prompt="Review PR #N in EtanHey/golems")

# CI completion command for native Monitor
pr-watch <owner/repo> <N> --head <sha> --deadline 2h
```

Wait per the [waiting policy](../references/review-loop.md#waiting-policy-no-polling-turns), in order:

1. **T3 seat:** owning parent links created/taken-over/pushed PRs immediately, handles existing
   feedback and branch fixes/pushes, then calls `watch_pull_request`, inspects `watching:true` and ends.
   Ordinary wakes/pushes preserve the watch; no routine list/rearm. Unwatch before terminal/handoff.
   A delegated child reports its artifact and ends; it never watches.
2. **State needed now:** one bounded `gh pr checks <N>` read.
3. **Must sit and watch outside T3:** one watcher process, below.

Use `pr-watch` on PATH (installed in `~/.golems/bin`), or `scripts/pr-watch` from a golems checkout.

Outside T3 only, arm exactly one `Monitor(command="pr-watch <owner/repo> <N> --head <sha> --deadline 2h", timeout_ms=1800000)`
for GitHub CI. Monitor runs a command; it spends no model turns while it waits. pr-watch never merges;
an empty rollup is never READY. Use the
[exit-code table](../../../../scripts/pr-watch-lib/README.md#usage-and-exits)
and [shared arming rules](../references/review-loop.md#watcher-process-pr-watch)
for head movement and deadline handling. The 30-minute Monitor expiry precedes the 2h --deadline;
re-arm on expiry after TaskStop cancellation, since re-arming restarts the deadline and the settle window.
Each re-arm is a model turn, so a long wait belongs on the T3 watch instead.

No `ScheduleWakeup`, `CronCreate` or `/loop` polling turns for CI or reviews, and no second watcher on
the same PR. In a cmux fleet without T3, addressed review handoffs follow the
[cmux adapter](../references/review-loop.md#cmux-adapter-fallback-cmux-fleets-without-t3): native
Monitor, `/collab-monitor` for filtering, TaskStop cancellation and re-arming at expiry/after
compaction. Fetch review bodies once a handoff or slim activity count changes.

## Post-merge BrainLayer Store (Claude-only)

```bash
brain_store(
  content: "[date] PR #N merged — <what changed and why>",
  tags: ["pr-merged", "<project>", "agent:golemsClaude"],
  importance: 7
)
```

## Agent Identity Signature — Claude read paths (ratified 2026-08-08)

Convention + failure modes: [../references/github-identity.md](../references/github-identity.md).
`harness` is `claude-code`. Claude's job is supplying `model` and `session` from **live** session
metadata at write time — not from launcher env, not from self-report, not from the cmux spawn
registry, and never cached at spawn (Etan switches models mid-session).

```bash
# Session JSONL for this session (Claude Code writes one file per session):
JSONL=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)

# model — LAST assistant turn wins; drop the "<synthetic>" sentinel, which is not a model
MODEL=$(jq -r 'select(.message.model) | select(.message.model != "<synthetic>") | .message.model' \
        "$JSONL" | tail -1)                                                   # e.g. claude-opus-5

# session id prefix (verified field: .sessionId)
SESSION=$(jq -r 'select(.sessionId) | .sessionId' "$JSONL" | head -1 | cut -c1-8)

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

**Why "last turn", not "the session's model" — measured evidence (2026-08-08):** session
`08d077d1` (orchestrator) contains **three different models in one file** — `claude-fable-5`,
`claude-opus-4-8`, and `claude-opus-5` — because Etan switched models mid-session. A value read at
boot would have been wrong for most of that session's writes. This is Q1's ruling in the data.
The same sweep found `"<synthetic>"` written into `.message.model` on non-assistant records; it is a
sentinel, never a model, and must be filtered out before it reaches a signature.

Use the running context's live model, including subagents that did the work. If its
turns are not flushed, use harness runtime metadata; otherwise sign with `unknown`.
Re-read per GitHub write. No effort in the signature or commit trailer.

Observed effort is allowed only on the Loop-record line.

## Hierarchical Worker Mode

For worker endpoints, draft handling, head verification, and artifact rules, read
[dispatch and handoffs](../references/dispatch-and-handoffs.md) and
[merge and verification](../references/merge-and-verification.md).

## Unique Capabilities

- `Agent(subagent_type="coderabbit:code-reviewer")` — spawns real code review subagent
- Native `Monitor` — runs one `pr-watch` process with no model turns while waiting; the T3 PR watch comes first
- BrainLayer MCP — post-merge brain_store (mandatory per pr-loop spec)
- `--worktree` isolation — `claude --worktree feat/name` for parallel PRs
