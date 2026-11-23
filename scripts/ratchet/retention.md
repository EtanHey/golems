# Ratchet run evidence retention

`node scripts/ratchet/prune-runs.mjs` defaults to LIST (also `--dry-run`).
The run directory is the main checkout's `docs.local/ratchet-runs`, resolved
from the script's git common directory, regardless of the caller's cwd.
Columns: path / PR / state / age in days / allocated bytes / reason / action.
GOLEMS_RATCHET_RUNS_KEEP is ignored with a warning; the 3/1 policy is fixed.

Keep the newest three runs per OPEN PR (runs, not distinct SHAs). For a merged
or closed PR keep its newest run for fourteen days after closure, then none.
Recognized non-PR lanes (for example m1-procedure) keep their newest three
runs per lane, rather than three distinct SHAs. PR-looking aliases remain
unknown and KEEP. These counts never override citations or the two-hour recent-write guard.
Run names use ASCII digits. Unmarked timestamps use the writer host's local
timezone, as shell `date` writes them; an explicit Z means UTC. Run corpora
must be evaluated in their writer's timezone. Unknown names and
SHA-less live runs KEEP conservatively. Unknown state, invalid closure
metadata or invalid/future timestamps KEEP. Files are never candidates.

PR bodies, issue comments, review comments and review summaries protect
named directories and SHA prefixes, including real ratchet-verdict head
and producer SHAs. The 64-character receipt hash does not pin a run.
Fetch all open PR evidence plus closed PRs represented in this corpus.
When non-PR lanes occur, fetch every closed PR too, since any of them may
link to a lane run. Failed or incomplete citation reads abort before apply. Closed/merged sticky evidence remains protected.
A GitHub read or malformed response error aborts before apply (everything
remains). Symlinks anywhere in a candidate tree or root alias abort scanning.

`--apply` explicitly removes candidates. It validates every candidate first,
then rechecks identity, size, latest descendant mtime and the two-hour guard
immediately before each removal. Filesystem errors stop immediately. This
is not an atomic snapshot or writer lock; stop writers before applying.
APFS snapshots can delay physical reclamation. No real apply was performed
for this PR; apply verification uses fixture directories only.

`post-merge-live.sh` retains its existing invocation of this command after
posting its live receipt. No new nightly wiring is introduced. Never invoke
apply from candidate pre-push/local-run.sh. The Mac ratchet-runs-size row
remains report-only at the 10 GB ceiling. Mac rows for this PR are lead-routed.
