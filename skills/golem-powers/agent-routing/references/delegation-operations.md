# Delegation Operations

This is the worker-lifecycle contract; read it before launching, reusing, monitoring, recovering, transferring, or closing a lane.

## Launcher Boundary

Agent routing chooses who; `/repogolem` owns launch law, including model defaults, explicit `-m`/`-E`, resume continuity/failures, `-s`, `-w`, and raw escape hatches.

```bash
brainlayerCursor -s "one-sentence read-only task"
brainlayerCodex -s "one-sentence implementation outcome"
```

Launchers handle cwd, MCP wiring, env vars, profile, secrets, and tab metadata. Never substitute raw
`cursor`/`codex`/`claude`, copied env vars, manual `cd`, or `--fast`. Internal ephemeral children are
a different harness, but `--fast` remains forbidden there. Use `/repogolem`'s raw escape only for
documented edge cases. Non-Codex model law lives in canon #5.

## Goal Delegation Contract

1. **Reuse before spawn.** Reuse a healthy referenced/existing worker in the same repo/workspace/role lane unless the user explicitly asks for replacement.
2. **Supersede narrow goals.** Send one explicit superseding goal to the same `agent_id`; do not fork the lane for a cleaner prompt.
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

Every monitoring cycle checks:

- Is the lead burning context on Cursor/Codex work while workers sit idle?
- Are worker surfaces alive? Recover a failed managed lane on a new surface within 60 seconds,
  redeliver its original goal, and notify the lead; do not wait for the lead to notice.
- Does every dispatching lead have its own monitor loop?
- Is the lead waiting on file-backed completion instead of polling large scrollback?
- Does the goal still preserve the user's full mission?

Checkpoint branch, commit/PR, `agent_id`, report path, DONE marker, service/MCP state, and exact blocker.
If in scope and recoverable, continue through `/pr-loop`, restart/reload/re-index, or rebuild. If the
current agent cannot reconnect after restart, resume or spawn a managed successor with the same goal
and handoff. Verify with the real post-operation probe.

Ask Etan only for irreversible/out-of-mission actions: destructive data deletion, force-push/history
rewrite, unowned cleanup, credential/account changes, paid external actions, or human-only license/ToS acceptance.

## Isolation and Quota

| Scenario | Route |
|---|---|
| Sequential specialist | One branch in the main repo; no worktree/sandbox. |
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
