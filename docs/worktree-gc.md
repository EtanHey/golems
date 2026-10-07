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

## Temporary disk health reporting (#710)

Per orc/Etan's 2026-10-07 ruling, `disk-free-floor` has
`report_only: gc-success-on-both-macs`. It still measures actual free GiB and
counts the GC's guarded REMOVE plans against the unchanged default thresholds
60 GiB / 25 worktrees. An unhealthy completed measurement remains `FAIL` in the
health cell and `WARN (report-only)` in the table; it alone cannot fail the aggregate.
Healthy data remains PASS. Missing, invalid, contradictory or failed source/plan
measurements fail the aggregate. Other rows remain enforced. The explicit warning
measurement travels in the head-bound verdict; the consumer validates it instead
of claiming all four real rows passed.

Enforcement resumes only after the lead has durable proof of one successful real
GC run on BOTH the MBP and M1. Merge, installation, a dry-run or a prune plan does
not satisfy that milestone. Completed apply/nightly exit 0, absence of a FAILED
marker, zero REMOVE plans or zero eligible lanes also do not qualify. Restoration
checklist:

- Retain a receipt per host: host identity, full installed GC commit, actual apply
  command, start/end timestamps, exit/completion disposition and full durable audit
  log, verified archive receipts and all KEEP/failure data.
- Each host must have a successful census, no registry/census KEEP-undetermined
  rows, and actual nonzero lane removals with matching REMOVING/REMOVED audit rows
  and verified archive receipts. There is no zero-removal exception.
- The lead verifies these conditions and containment on each host and links both
  receipts in the restoration PR. Neither host may be inferred from the other.
- Remove only this row's `report_only` field in a normal reviewed commit, retaining
  its measurement, thresholds and history. Do not turn a low-disk result into PASS.
- Rerun the current-head tables/consumer checks: unhealthy health blocks the
  aggregate again; source failures and unrelated failures must still block.

Separate follow-up: nightly can complete with exit 0 while registry failure keeps
every lane. A distinct alarm/exit for that stall is not implemented here; it never
counts as restoration evidence. The row stays report-only until BOTH qualifying
host runs are proved.

The report-only condition changes merge gating, not the creation floor or any
permission to delete. Real GC, activation and installation remain lead-owned.
