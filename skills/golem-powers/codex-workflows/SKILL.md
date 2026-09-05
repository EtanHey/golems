---
name: codex-workflows
description: "Verified headless Codex worktree fan-out. Triggers: codex-workflows, headless Codex, Codex parallel. NOT for healthy cmux single-worker tasks."
---

# Codex Workflows

Use this skill for headless parallel Codex dispatch or when cmux is unavailable.
Healthy cmux panes remain the default for visible, reachable single-worker tasks;
headless mode is a fan-out engine and degraded fallback, not a cmux replacement.

Run the harness through `scripts/codex-workflows.sh`. Detailed interfaces are in
`workflows/agent.md`, `workflows/parallel.md`, and `workflows/pipeline.md`.

## Primitives

- `agent` creates one isolated worktree, launches one worker, verifies startup,
  and records it in an explicit manifest.
- `parallel` validates a JSON fan-out spec, launches every worker before
  watching, and keeps every outcome in one manifest.
- `pipeline` runs ordered stages, parallel within a stage, and stops on failure
  before the next stage unless `continue_on_failure` is explicitly enabled.
- `watch` observes process exit first, then parses the finished log once.
- `status`, `harvest`, and `cleanup` make inspection and retirement mechanical.

## Non-Negotiable Guards

1. Discover the real default branch with `git remote show origin`. Never assume
   `main` or `master`.
2. Launch `$HOME/.local/bin/codex` through `/usr/bin/nohup`. Never
   invoke bare `codex`; a captured PID is not a worker.
3. Use one worktree, branch, and log per worker. Grant workspace-write access to
   the repository Git directory and explicit reporting paths with `--add-dir`.
4. Verify startup after a grace period. Report `FAILED_LAUNCH` loudly when the
   process died or launcher diagnostics show an executable, command, or fetch
   failure.
5. Never live-grep a worker stream. Wait for process exit, then extract exact
   `TASK_DONE`, PR URLs, and failures from structured finished-log events.
6. Pin the bounded-work default to `gpt-5.6-luna` with explicit `xhigh` or `max`
   reasoning effort. Record the effective model/effort, output tokens, and
   wall-clock duration in the manifest and run log.
7. Treat `TASK_DONE` as a signal, not artifact proof. Harvest only declared
   worktree-relative, non-symlink artifacts; do not clean up before harvest.

## Worktree Hygiene (folded from superpowers:using-git-worktrees, 2026-09-02)

Guard 3 says one worktree per worker; these two checks say the worktree is safe to
work in. Folded when the superpowers plugin was dropped (XS-2) — source
`superpowers/3.4.1/skills/using-git-worktrees/SKILL.md` L55-69 and L120-134.

1. **Verify the worktree root is git-ignored BEFORE creating anything in it.**
   Repo law puts worktrees at `<repo>/.worktrees/<name>` (AGENTS.md), so the only
   open question is whether git ignores that path here:

   ```bash
   # Probe a CHILD path, not the bare root: `.worktrees*/` is a directory-only
   # pattern, so `git check-ignore -q .worktrees` returns 1 on a fresh checkout
   # where the directory does not exist yet — a false "NOT ignored".
   git check-ignore -q .worktrees/probe || { echo ".worktrees NOT ignored"; exit 1; }
   ```

   Not ignored means every worker's checkout shows up as untracked files in the
   parent repo and can be committed by accident. Fix it (add the line, commit it)
   before the first `git worktree add`, never after. (L55-69)

2. **Prove a clean baseline before the worker implements anything.** Run the
   project's test command in the fresh worktree first and record the result in the
   manifest. A green baseline is what lets you attribute a later failure to the
   worker's change; without it you cannot tell a new bug from a pre-existing one.
   Baseline red is not a blocker by itself — report the failures and get an
   explicit go/no-go rather than silently building on top of them. (L120-134)


## Degraded-Mode Contract

Every headless run and worker record must state the same four facts:

- `lead-reachable-only`
- `no-pane`
- `no-listen-name`
- `no-self-monitor`

Name the dispatching lead. ARM-MONITORS registration must describe the worker as
lead-reachable-only; do not invent a pane, listen-name, or monitor.

## Completion Interpretation

`parallel` without `--watch` proves launch only, records `completion_proven:
false`, prints `LAUNCH_ONLY`, and exits 75 so it cannot be mistaken for completed
work. With `--watch`, success requires every worker to reach `completed`.
`failed_launch`, `failed`, `watch_timeout`, `parser_failed`, and `incomplete` all
return nonzero. A watch timeout preserves the live process and log so another
watch can resume.

See `references/manifest.md` for states and
`references/composition.schema.json` for the fan-out/pipeline input contract.
