# Delegation Operations

This is the worker-lifecycle contract; read it before launching, superseding, monitoring, recovering, transferring, settling, or closing a lane.

> **Adapter scope.** The monitor-loop, pane-recovery and isolation mechanics below are the cmux
> adapter (visible pane lanes). A lead dispatching from a T3 thread follows
> [t3-native.md](t3-native.md) for dispatch, wait, isolation and settle instead: the child's
> completion wakes the parent (no monitor loop), and an editing child gets `isolation: "worktree"`.
> The mission, artifact-verification and real-green rules still apply to both.

## Launcher Boundary

Fleet canon #6 owns launch law; `/repogolem` owns model flags, resume, worktrees, invocation examples,
and raw escape hatches. `--fast` is forbidden in every harness, including internal children.

## Goal Delegation Contract

1. **One PR = one fresh implementer.** Every new PR, including each dependent-stack layer, gets a new implementer (new `delegate_task` or new pane, fresh context), even when a healthy idle worker exists in the same repo/workspace/role. Only that PR's own review-round fixes may reuse it. A successor gets a short brief and a compact checkpoint, never full plans or logs. Lifetime cap, fresh reviewers, the 4-Codex concurrency cap and settling: `SKILL.md` § Lead Topology #5. An explicit user instruction naming a worker overrides this default; lead convenience never does.
2. **Supersede within the PR.** A corrected or widened goal for the same PR goes to that PR's implementer as one explicit superseding goal; do not put a second implementer on the same PR for a cleaner prompt. A new PR is never a supersede (item 1), and a session past ~100 turns hands off to a fresh delegate with a compact checkpoint.
3. **Preserve the full delegation.** Copy the whole mission, not just the next blocker. Include every requested service, data-safety, coverage, state, and green/no-green condition.
4. **Use a file-backed goal.** Complex or multi-hour work gets an absolute goal file with constraints, success criteria, report path, exact DONE marker, and green/no-green criteria.
5. **Monitor artifacts, not vibes.** Wait on the report/DONE marker with low-frequency health checks. Read pane scrollback only for delivery failure, wedged prompts, or state disagreement.
6. **File completion beats pane silence.** A report marker triggers artifact verification. Registry/pane disagreement is cmux health evidence, not permission to rerun the lane.
7. **Zero workers means terminal state.** Close only verified `DONE`, file-backed `BLOCKED`/`NOT_GREEN`, or `TRANSFERRED` with successor `agent_id` and delivery evidence. Otherwise record `closure_without_artifact` and keep it visible.
8. **Green means real green.** PR/CI/UI status is not domain health. Run the goal's real probe; unresolved queues, coverage, vectors, or service gaps mean `NOT_GREEN`.
9. **User confusion is a stop sign.** Pause spawning/patching, explain current evidence, and store the correction separately.
10. **Raw/orphan escape hatches converge.** Recover/register or replace the lane with a managed `agent_id` and correct topology before treating it as production.

Delivery syntax is harness-specific:

```text
Codex, only when verified: /goal Read and execute this goal file until complete: /abs/path/to/goal.md
Gemini/Antigravity: Read and execute this goal file until complete: /abs/path/to/goal.md
Cursor: use its verified goal command or a plain file-contract message; verify accepted/working state before resending a duplicated footer prompt.
```

## Monitoring and Recovery

Fleet law for approved queues, permission parking, and route-through-leads lives in canon #8.

Every cmux monitoring cycle checks:

- Is the lead burning context on Cursor/Codex work while workers sit idle?
- Are worker surfaces alive? Recover a failed managed lane on a new surface within 60 seconds,
  redeliver its original goal, and notify the lead; do not wait for the lead to notice.
- cmux adapter: does every dispatching lead have its own monitor loop? (T3 children need none: completion wakes the parent.)
- Is the lead waiting on file-backed completion instead of polling large scrollback?
- Does the goal still preserve the user's full mission?

Checkpoint branch, commit/PR, `agent_id`, report path, DONE marker, service/MCP state, and exact blocker.
If in scope and recoverable, continue through `/pr-loop`, restart/reload/re-index, or rebuild. If the
current agent cannot reconnect after restart, resume or spawn a managed successor with the same goal
and handoff. Verify with the real post-operation probe.

Ask Etan only for irreversible/out-of-mission actions: destructive data deletion, force-push/history
rewrite, unowned cleanup, credential/account changes, paid external actions, or human-only license/ToS acceptance.
"Nothing waits on Etan except true one-way doors: deleting data/creds/accounts, money, messaging people.
Tags, releases, installs, deploys, upgrades ship without asking." (Etan 2026-10-19, via orc) Force-push and
remote deletes stay behind the human-confirm-gate token: they delete data.

## Isolation and Quota

| Scenario | Route |
|---|---|
| Sequential specialist (cmux adapter) | One branch in the main repo; no worktree/sandbox. |
| T3 child that edits files | `delegate_task` with `isolation: "worktree"` ([t3-native.md](t3-native.md) § 2). |
| Truly parallel, no file overlap | Native worktrees; verify MCP/config paths; no restrictive sandbox. |
| Parallel with file overlap | Serialize. |

Usage is managed by counting dispatches, bounding workers, and avoiding duplicate spawns. An agent
that exhausts shared quota through its own dispatch reports that dispatch as the cause, not the later
`resource_exhausted` state as an external root cause.

## skillCreator Domain

Skills, hooks, agent definitions, and global agent settings route through skillCreator. Before editing
`~/.claude/skills/**`, `~/.claude/hooks/**`, `~/.claude/agents/**`, `~/.claude/CLAUDE.md`, or
`settings.json`, search BrainLayer for `agent-routing skillCreator domain`. If skillCreator is not in
the loop, signal the lead and pause until it reroutes or adds a skillCreator audit.

Orchestrators perform the same route-check before dispatch: scan the mission for those path classes,
reroute the touching work to skillCreator or add an explicit pre-merge skillCreator audit, and do not
send the mission onward until that audit path is named.

This rule came from the 2026-05-16 incident: implementation quality was acceptable, but a skill/hook
change reached merge with no skillCreator audit. The test is simple: before patching a skill/hook,
can you name the skillCreator review path? If not, stop.
