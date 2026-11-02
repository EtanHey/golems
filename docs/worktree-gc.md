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

Exit codes: 0 = completed; 3 = completed with KEEP-unpushed; 2 = invalid input
or any per-repository failure. Each per-repo failure, including crashes with exit
1 or 7, is logged as an ERROR row with its original exit code and reason, and the
sweep continues with the next repository. The final exit is 2 if any repo failed;
2 outranks 3 even when another repo has KEEP-unpushed. The nightly wrapper maps
only 3 to success and preserves other failures. Shutdown signals and timeout kill
the prune process group before releasing the suite lock.

Every scan writes `docs.local/worktree-gc/last-run.{json,md}`, including ERROR
rows for failed repositories. `latest.{json,md}` is the last FULL scan, complete
or partial, including scans that exit with an error. Scoped runs (`--repo`,
`--path`, or `--prune-plan`) never change `latest.*`. Reports include `status`,
`error_count`, and an error `stage` on ERROR rows. Lookup failures remain exit 0
with `status=partial`; processing failures exit 2. Markdown is replaced first,
then authoritative JSON, each via a temporary file and rename. Compare the shared
`generated_at` to detect reads across publication. A publish failure exits nonzero
with `report publish failed` and cleans temporary files. EXIT reporting cannot
cover SIGKILL. Per-run `.repo-state` and `.repo-stderr` scratch files are removed
on exit.

Nightly GC runs the pinned `$HOME/Gits/golems/.worktrees/hooks-live` copy and refuses
an unverified pin, logging its SHA. Verified means an unmodified published master
commit at or after `GC_MIN_SAFE_SHA`, not necessarily the latest commit. Raise the floor with every GC safety fix.
Every run logs how many commits the pin is behind the fetched origin/master
(or that lag is unavailable); there is no hard freshness limit. The full remote
ref is authoritative, even if a local branch has the same short name.
An outside wrapper re-execs the verified pinned wrapper so its library and GC
come from the pin. A `GOLEMS_WORKTREE_GC_PIN_ROOT` override emits a WARNING with
its path, including on refusal.

The default completed-run reports now live in the pin's `docs.local/worktree-gc/latest.{json,md}`
(unless `WORKTREE_GC_REPORT_DIR` overrides that location).
Refused nights are visible only in the launchd log (`StandardErrorPath`),
rendered as `@GOLEMS_ROOT@/docs.local/worktree-gc-launchd.log`; they do not update
`latest.*`. Inspect that log to detect a pin that keeps refusing.
Verification can still race a concurrent `install-hooks --update`; the installer
does not take the nightly lock.

Tests build repositories outside any Git tree and guard every GC invocation against
leaving the fixture root. Never probe `--apply` on a real repository. Installation
and launchd loading belong to the lead after review and merge.

Known limits retained from R2: a writer can race between archive and removal; a Git
removal failure can leave a partially removed, unregistered tree. Failed archives
can leave partial destinations that require manual inspection.

## Temporary disk health reporting (#710)

Per orc/Etan's 2026-10-07 ruling, `disk-free-floor` has
`report_only: gc-success-on-both-macs`. It measures Available via
`brainlayer disk --json` and counts the GC's guarded REMOVE plans. Per Etan's
2026-10-26 ruling, the disk alarm floor is 50 GB Available
(decimal GB, 1 GB = 1,000,000,000 bytes); the worktree ceiling remains 25.
The report names Available and free now. If the bounded probe is unavailable,
it checks raw free-now bytes with an explicit "free-now only; purgeable unknown"
label and reports Available as unknown. Worktree creation separately retains its
immediate-allocation floor configured in GiB; its refusal displays both measured
and required capacity in decimal GB. An unhealthy completed measurement remains
`FAIL` in the health cell and `WARN (report-only)` in the table; it alone cannot fail the aggregate.
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
- Each host must have a successful, complete authoritative current-session census
  covering all live lanes on that host. Retain coverage evidence bound to that host
  and the actual run, showing all live lanes covered. A syntactically valid empty
  or subset registry does not prove completeness. There must be no registry/census
  KEEP-undetermined rows, and actual nonzero lane removals with matching
  REMOVING/REMOVED audit rows and verified archive receipts. There is no
  zero-removal exception.
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
