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

## 3. Wait

- An async child's completion wakes the parent with a notification. End the turn. Do not poll
  `task_status`, schedule a wakeup, or spawn a watcher or collab monitor for it.
- "No polling turns. No collab-monitor wakes in Codex, and no "watch #410" loops. Use T3 completion
  notifications or a single bounded check." (Etan 2026-10-18, via orc collab)

## 4. On wake: verify, relay, settle

- Read the report (`task_status` summary). A DONE line is a prompt to verify, not a receipt.
  `workState: waiting_for_children` or `hasPendingChildRuns` means the child is not finished.
- Before relaying, verify the artifact: the PR exists and is not a draft, its head SHA matches the
  reported head, and its file list matches the scope (`gh pr view <url> --json
  headRefOid,files,isDraft,labels`). Re-run a cheap claimed check or hand it to a cheap verifier.
- Relay only the verified values, then conclude the child: no further sends for new work. At its
  PR's terminal state settle it ("settle idle workers"; "the implementer removes its worktree at
  DONE" (Etan 2026-10-18, via orc collab)).

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
