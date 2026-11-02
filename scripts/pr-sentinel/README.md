# PR sentinel

Two checks, no daemon:

- **`lead --thread <id>`: one lead's PRs.** Every lead runs it from a cheap delegate on a 5-minute
  T3 schedule. It reads the lead's open PRs from T3 (`t3 thread show`) and GitHub (one GraphQL search).
  - When GitHub blocks a merge only because the branch is behind (`mergeStateStatus: BEHIND`), it
    runs `gh pr update-branch` itself and tells nobody. It never updates optionally: that would
    rerun CI and invalidate exact-head evidence for nothing.
  - It messages the lead only for a decision: red CI, a conflict, a review that asked for changes,
    or green and mergeable. It messages once per head and state, after a 10-minute grace, so the
    T3 PR watch wakes the lead first.
  - Drafts and visibly held PRs (a comment starting `**Held on purpose`) are left alone.
- **`scan`: orc's sweep.** Covers what no lead's check sees: PRs whose lead thread is settled or
  gone, and PRs no thread links. These go to `escalate_thread` (orc). A live lead's PRs are its own
  check's job. The TLA+ model in `docs/tla/lead-wait/` shows why both are needed: a lead's watcher
  stops when the lead settles.

## Start a lead's check (once per lead thread)

Delegate a cheap child and let it schedule itself. A schedule bound to the child's own thread runs
on the child's model, inside that thread, and does not wake the lead. An *unbound* schedule runs on
the default model (Opus) and creates a new thread and git worktree per run: never use one for this.

```text
delegate_task(
  title: "PR check for <lead name>",
  target: { providerInstanceId: "claudeAgent", model: "claude-haiku-5-5",
            options: { effort: "low" } },   # Haiku takes only `effort`; or codex gpt-6-luna with { serviceTier: "default" }
  task: "Load mcp__t3-code__schedule_task with ToolSearch and call it once: bindToCurrentThread
         true, schedule {type: interval, everyMs: 300000}, title 'PR check for <lead>', prompt:
         'Run exactly this one shell command, with nothing after it:
         <golems>/scripts/pr-sentinel/pr-sentinel lead --thread <LEAD_THREAD_ID>
         It updates branches and messages the lead itself. Reply with one line: the last line of
         its output. Use only the shell tool, for that one command.' Reply with the scheduledTaskId,
         then stop.")
```

Put the command on its own line with nothing after it: a sentence-ending `.` gets passed as an
argument and the check fails (seen live). Verify it once with `run_scheduled_task_now` and read the
child's reply.

Record the `scheduledTaskId` in your notes. **Before settling or retiring the lead thread**, delete
it with `delete_scheduled_task`, and hand your open PRs to a live lead (pr-loop § Waiting policy).

## orc's sweep

Copy `config.example.json` to `~/.config/golems/pr-sentinel.json` (mode 0600, outside this public
repo). Run `scan --dry-run` to see the inventory and the proposed messages; `status` prints state.
Scope it before use:

- **Scope `queries` to the repos the fleet works on**, e.g. `is:pr is:open repo:OWNER/a repo:OWNER/b`
  (several `repo:` qualifiers are OR'd). The default matches every open PR the account ever opened;
  a first dry-run found 79 PRs and drafted 61 messages.
- **Upstream green PRs never fire.** GREEN needs WRITE, MAINTAIN or ADMIN on the repo.
- **`projects` must match T3's workspace roots exactly**, including case.
- **Only this Mac's T3 threads are visible.** A PR owned by a thread on another machine looks UNLINKED.

Notes: the 300-result search cap and the 100-check-context limit are conservative; incomplete check
inventory aborts the scan. Undelivered messages retry on the next run. A crash between a send and the
state write may repeat a message once.
