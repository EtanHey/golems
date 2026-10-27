# T3-Native Dispatch

> The child lifecycle for a lead running in a T3 thread. SKILL.md § Routing rules (SSOT) picks the
> vendors; this file owns the T3 mechanics. Visible cmux fleets follow SKILL.md § Dispatch
> Boundaries › cmux adapter instead.

Why this exists: "Codex seats must not poll collabs; T3 delegate completions already wake you."
(Etan 2026-10-18, via orc collab)

## 1. Discover

- Call `orchestrator_capabilities` before the first `delegate_task` of a lane. Pick the provider
  instance and model from its live catalog (the composer's catalog, custom models included), never a native tool's model list:
  that list is not the full set.
- Resolve the role first (`node scripts/model-roles.mjs <role> --field model`), then match it in
  the catalog. Pin `target.providerInstanceId`, `target.model` and the effort option the catalog
  advertises in `target.options` on every dispatch (canon #5: "Every non-Cursor Agent/Workflow/Task
  spawn pins its model explicitly."). An inherited model is not a pin.
- The role's model is missing from the catalog → report `BLOCKED` to the lead. Never substitute.

### Codex instances

For ordinary Codex implementers, recon and reviewers, explicitly select `target.providerInstanceId: "codex-worker"`.
A Codex child inherits its parent's Codex instance. A Claude lead naming only the codex driver gets whichever
codex instance T3 lists first (OrchestratorMcpService.ts:1337-1386); always name the instance.
Remember: the role picks the model, the work type picks the instance.
Keep `codex` for security (implementers + scans), UI / computer-use recorders, browser / web-QA workers,
leads and Etan. Codex reviewers on security or full-panel PRs stay on `codex`; ordinary Codex reviewers use `codex-worker`.

If `codex-worker` is missing from `orchestrator_capabilities`, fall back to `codex` per dispatch and
report to the lead. This is not a BLOCKED condition: an instance isn't a model; keep the role's model pin.
Recreating the instance is a lead action.
Leads note in their STATUS how many of their Codex dispatches named `codex-worker`.

Recreate the worker instance in `~/.t3/userdata/settings.json` under `providerInstances` (hot-reloaded).
Merge this entry into the existing map:

```json
{
  "providerInstances": {
    "codex-worker": {
      "driver": "codex",
      "displayName": "Codex worker (lean MCP)",
      "config": {
        "binaryPath": "~/.local/bin/codex",
        "launchArgs": "-c plugins._default.enabled=true -c plugins.'codex-security@openai-curated-remote'.enabled=false -c plugins.'computer-history@openai-bundled'.enabled=false -c plugins.'computer-use@openai-bundled'.enabled=false -c plugins.'unified-computer-use@openai-bundled'.enabled=false -c mcp_servers.node_repl.enabled=false -c thread_unload_delay_secs=60"
      }
    }
  }
}
```

T3 needs an absolute path: expand `~` to your home directory when pasting. The single quotes delimit plugin IDs in `launchArgs`; argument splitting removes them
before Codex receives the dotted configuration keys.

`binaryPath` must be the `~/.local/bin/codex` link, which follows Codex upgrades, never a versioned release path.
`CODEX_HOME` defaults to the shared `~/.codex`; no credential copy. To undo, remove the entry.

Precondition: `T3CODE_CODEX_LAUNCH_ARGS` must stay unset in the T3 server env. If set, it REPLACES
every Codex instance's launchArgs (codexLaunchArgs.ts:5-8), so the worker loses its trim.
Check `launchctl getenv T3CODE_CODEX_LAUNCH_ARGS` (empty), then inspect the running T3 server env:
identify its PID from `ps -axo pid,ppid,args` and check `ps eww -p <server-pid> -o command=` locally
for that variable. Do not paste the whole environment; report only whether this variable is absent.

#### C5: live one-shot after an upgrade

After every Codex CLI upgrade (noticed by `whats-new` or a `codex --version` check), the lead
dispatches this one-shot check to read-only children and only reads their reports.
`plugins._default` behaviour needs fresh evidence after each upgrade:

1. Dispatch a read-only child on the running `codex` instance to collect a current baseline of its
   app-server's MCP children by family using the same ancestry/count method below. The child returns
   family names and counts, not raw process environments; supply its report to the child in step 2.
2. Dispatch one trivial read-only delegate with `target.providerInstanceId: "codex-worker"`, the role's
   model and default service tier. Give it this task: "Walk your own ancestry from the shell/Python PID
   through PPIDs (`ps -axo pid=,ppid=,args=`) until your `codex app-server`. Record that app-server PID
   and count its children by family, including MCP descendants behind launcher wrappers. Use this
   app-server's process tree, never a machine-wide count. Report codex-security, computer-history,
   node_repl, cua_repl, BrainLayer, VoiceLayer, and every other running MCP server/plugin family;
   missing families count as zero. Compare with the supplied current baseline from the `codex` instance.
   Return counts and added family IDs only; change nothing."
3. **PASS (accepted C1 rule):** codex-security, computer-history, node_repl and cua_repl all 0,
   BrainLayer and VoiceLayer present, and no other new MCP family versus the `codex` instance.
   Disabled entries are allowed; compare running families. Missing ancestry or baseline evidence cannot pass.
4. **FAIL:** dispatch ordinary work on `codex` and report to the lead that owns the instance
   (lifecycle lead, else skill-creator), with the counts and any added families. Use `codex` for
   ordinary dispatches until the owner restores the trim and a fresh check passes.

## 2. Dispatch

- `delegate_task` with `mode: "async"`. Use `mode: "wait"` only when this turn cannot continue
  without the result; its `timeoutMs` is the parent's wait budget and never cancels the child.
- Retain the returned `taskId` (STATUS file or lane notes). `task_status` is for a result needed
  mid-turn; `task_cancel` stops a child and its queued turns.
- `clientRequestId`: one per round, stable across retries of that same round; a new round gets a
  new id.
- `isolation: "worktree"` for anything that edits files. The worktree branches from the parent's
  **committed** local HEAD and runs project setup. Uncommitted edits and gitignored files
  (`docs.local/` briefs, `.env`) are not copied: commit what the child needs, or pass absolute paths
  into the parent checkout. Omitted isolation shares the parent checkout; keep that to read-only work.
- Set `role` to match the brief (`implementation`, `review`, `research`). Leave `runtimeMode` unset:
  a supervised mode parks the child on human approvals the parent cannot give. Restrict a child in
  its task text instead.
- The task prompt is the child's whole context; it gets no parent history. A payload over a few
  lines goes to a file, sent as `Read and follow <absolute path>`, and names the skills the child
  invokes.
- **Cold child = fresh child.** Prompt-cache windows are Claude ~60 min and Codex ~30 min (Dara A.,
  2026-10-19). If the lead has been idle longer than the child's window, dispatch a FRESH child with a
  compact checkpoint (brief path, PR URL and head SHA, open findings) instead of a `t3_thread_send` or
  "Read and follow" into the old child: waking a cold child re-reads its whole context uncached
  (Claude 7.4M + Codex 0.4M tokens a week, cache audit 2026-10-19). A same-PR fix round inside the
  window may still reuse the child (SKILL.md § Lead Topology #5).

## 3. Wait

- An async child's completion wakes the parent with a notification. End the turn. Do not poll
  `task_status`, schedule a wakeup, or spawn a watcher or collab monitor for it.
- "No polling turns. No collab-monitor wakes in Codex, and no "watch #410" loops. Use T3 completion
  notifications or a single bounded check." (Etan 2026-10-18, via orc collab)
- If a timer wake is unavoidable (a Monitor `timeout_ms`, `ScheduleWakeup` `delaySeconds`, a cron or
  background-watcher interval), keep the delay inside the seat's cache window: ≤50 min on a Claude
  seat, ≤25 min on a Codex seat. Never 3600 s: wakes past the window cost Claude 7.4M tokens a week
  (20 busts; 35 Monitor arms at 3600 s, cache audit 2026-10-19). Prefer the completion notification.

## 4. On wake: verify, relay, settle

- Read the report (`task_status` summary). A DONE line is a prompt to verify, not a receipt.
- Task completion comes from `status`, `workState` and `summary` only. `workState` of `working` or
  `waiting_for_children` means the task is not finished ("a completed turn with live nested work is
  not a completed task"). A terminal status with `workState` `result_available` means it is: the
  `summary` is the final result and "remains stable after publication". Harvest it now.
- `hasPendingChildRuns` is later activity in the backing child thread, not task state:
  it "does not reopen the task", even when true after completion. It is not a reason to delay
  harvesting. Treat it as cleanup: once the summary is verified and relayed, `task_cancel` the
  `taskId` ("task_cancel stops those turns too"). (Live `task_status` contract, quoted.)
- Before relaying, verify the artifact: the PR exists and is not a draft, its head SHA matches the
  reported head, and its file list matches the scope (`gh pr view <url> --json
  headRefOid,files,isDraft,labels`). Re-run a cheap claimed check or hand it to a cheap verifier.
- Relay only the verified values, then conclude the child: no further sends for new work. At its
  PR's terminal state settle it ("settle idle workers"; "the implementer removes its worktree at
  DONE" (Etan 2026-10-18, via orc collab)).
- Before settle, require `git worktree remove` (no `--force`), then `git worktree prune`, and the
  receipt's removal proof that the path is absent from `git worktree list --porcelain`.
  Preserve dirty files or local-only commits; the receipt names the path, reason, and lead escalated to
  (`/pr-loop` § Cleanup Receipt). Neither proof nor an escalated exception = invalid receipt.

## 5. Review rounds

- The reviewer starts only after the implementer reports done (§ Routing rules (SSOT), Inner loop).
- Every round is a NEW `delegate_task` whose task carries the original brief, PR URL and head SHA,
  prior findings, the implementer's responses, and open objections. New `taskId`, new
  `clientRequestId`.
- Never continue a review with `t3_thread_send` to the `childThreadId`; that thread is backing
  storage, not a review channel.

## 6. Pending questions

- A child with `hasPendingQuestion` is the lead's to answer: read it with `t3_pending_request_list`
  / `t3_pending_request_read` (`threadId` = the `childThreadId`) and reply with
  `t3_pending_request_respond`. Its completion still wakes the parent afterwards.
- Routing, scope and model questions never go to Etan: "workers never ask Etan routing questions"
  (Etan 2026-10-18, via orc collab). Only an Etan-only decision becomes an `@etan` ask in the collab.

## 7. Top-level threads

- `t3_thread_launch` and `create_threads` create ordinary top-level conversations. Use them only
  when a separate or new thread is explicitly asked for. "Dispatch a worker/subagent" is
  `delegate_task`, never a thread launch.
- `t3_thread_launch` has no idempotency key: after a lost response, check `t3_thread_list` before
  retrying.

## 8. PRs

- `link_pull_request` for every PR opened in the lane, each stack layer included. The parent links
  it after verifying and checks `list_thread_pull_requests` before closing the lane.
- `watch_pull_request` is parent-owned: a child cannot watch, because its parent thread owns the PR.
  Handle existing comments first, then end the turn. A wake is news, not a merge decision.
  `unwatch_pull_request` before handing the work back.

## 9. Owned elsewhere

- Fresh implementer per PR, reviewer freshness, the Codex concurrency cap and settle timing:
  SKILL.md § Lead Topology #5. Not restated here.
- Vendors per work type and inner-loop order: SKILL.md § Routing rules (SSOT).
- Model per role: `standards/model-roles.json`; effort per `/large-plan` phase.
