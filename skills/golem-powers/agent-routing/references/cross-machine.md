# Cross-machine (linked environments)

> Canonical text for delegating to the other Mac (M4 Max ↔ M1 Pro) through a linked T3
> environment. Every other skill points here; none restates it. Provenance: XM-DELEG live trial,
> 2026-10-28. The trial replaced the
> m1-router thread as the launch transport; admission policy is unchanged (§ 5).

Environment ids come from `t3_environment_links`.

## 1. Short or read-only work: `delegate_task` with `target.environmentId`

- Completion wakes the parent. `task_cancel` works.
- Steer: `t3_thread_send(threadId=<remoteChild.threadId>, environmentId=<that env>, mode: "steer")`.
- It runs in that machine's project ROOT checkout, and `isolation: "worktree"` is REFUSED for
  linked environments. NEVER use this route for code writes.
- The response has `childThreadId: null` and `remoteChild.threadId`. Keep the remote id: steer,
  read and settle all need it.

## 2. Code writes on the other Mac: `t3_thread_launch`

- `t3_thread_launch(environmentId, projectId=<that machine's project id>, workspaceStrategy: {type: "worktree", baseRef: <verified ref>})`.
  This is the one sanctioned use of a thread launch for a worker (see t3-native § 7).
- It is top-level, so completion does NOT wake the launcher. The brief must tell the worker to
  report with `t3_thread_send(environmentId=<origin env>, threadId=<lead>)` (proven to work).
- The owner settles it: `t3_thread_organize({action: "settle", threadId, environmentId})`.

## 3. Project ids differ per machine

Resolve with `t3_project_list(environmentId)`. Never reuse the other Mac's project id.

## 4. PR watch across machines

Unverified; test on the first real remote PR. `watch_pull_request` accepts an `environmentId`,
but no cross-machine watch has been exercised.

## 5. Admission (policy, not transport)

≤3 heavy lanes on the M1, a ≥10 GiB disk guard, nothing in an M1 sync window, no brew/app
installs. A PHX admission go/no-go precedes the lead's direct launch. The m1-launch-queue
collab is an admission ledger (row = admitted lane + owner + env thread id), not a request queue.
