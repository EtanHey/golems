# Ratchet run evidence retention

`node scripts/ratchet/prune-runs.mjs` defaults to a dry-run against the main
checkout's `docs.local/ratchet-runs`, including when invoked from a worktree.
`--apply` removes the printed candidates. `GOLEMS_RATCHET_RUNS_KEEP` defaults to
3 distinct SHAs per lane, retaining the newest timestamped run for each SHA.
Names follow `<lane>-<7..40 hex SHA>-<YYYYMMDDTHHMMSS>[fraction][Z]` (up to six fractional digits).

Open PR bodies, issue comments, review comments and review summaries protect
named directories and cited SHAs. A failed GitHub read stops pruning. Unknown
names remain listed and kept; symlinks stop the operation. Files or directories
modified within two hours remain protected, including writes below a run root.
The apply step checks identity, timestamps and sizes again before each removal.
Allocated bytes are reported in decimal GB; APFS snapshots may delay reclamation.

`local-run.sh` invokes `--apply` after producing its receipt and posting its table.
For the M1 procedure owner (skill-creator): invoke the same command from the
golems checkout at the end of each procedure run. Procedure files are owned by
skill-creator and are deliberately unchanged here. The first real apply needs
lead coordination; this change's verification uses only a real dry-run and
isolated test directories.

The Mac `ratchet-runs-size` row reports allocated size with a 10 GB ceiling,
overridable via `GOLEMS_RATCHET_RUNS_MAX_GB`. It remains report-only pending
successful retention on both Macs. The disk free floor remains unchanged.
The lead must sequence merge and refresh open guarded PRs for the added row.
