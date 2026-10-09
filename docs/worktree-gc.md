# Worktree cleanup safety

`worktree-gc.sh --apply` removes only clean, merged, idle, unused one-level
`<main>/.worktrees/<name>` worktrees. Open PR branches, live process/cmux cwd,
locked trees, hooks-live, nested Git repositories and reflog-only commits are kept.
`--repo` must name a Git toplevel; `--path` selects one registered linked tree.

`--dry-run` reports merge eligibility. `--prune-plan` also checks the nightly
idle/live/nested-repository guards and emits REMOVE without archiving or deleting.
A REMOVE plan still requires successful archive verification before deletion.

Ignored data is archived under the main checkout's `docs.local/worktree-archive/`.
Only ignored caches at known locations are disposable. Every docs.local subtree
and every non-cache ignored ancestor protects all descendants. RECEIPT.tsv escapes
backslash, tab, newline and carriage return. Special files are skipped and recorded
as `special`; FIFOs are never opened. A durable REMOVING row precedes deletion.

Exit codes: 0 = completed; 3 = completed with KEEP-unpushed; 2 = invalid input;
other nonzero codes = runtime failure. Nightly maps only 3 to success. Shutdown
signals and timeout kill the prune process group before releasing the suite lock.

Tests build repositories outside any Git tree and guard every GC invocation against
leaving the fixture root. Never probe `--apply` on a real repository. Installation
and launchd loading belong to the lead after review and merge.

Known limits retained from R2: a writer can race between archive and removal; a Git
removal failure can leave a partially removed, unregistered tree. Failed archives
can leave partial destinations that require manual inspection.
