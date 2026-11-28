# Ratchet run evidence retention

`node scripts/ratchet/prune-runs.mjs` defaults to LIST (also `--dry-run`).
The run directory is the main checkout's `docs.local/ratchet-runs`, resolved
from the script's git common directory, regardless of caller cwd.
Columns: path / PR / state / age in days / allocated bytes / reason / action.
GOLEMS_RATCHET_RUNS_KEEP is ignored with a warning; PR retention is fixed.

Keep the newest three runs per OPEN PR (runs, not distinct SHAs). For a merged
or closed PR keep its newest run for fourteen days after closure, then none.
The non-PR lane allowlist contains only `m1-procedure`: keep its newest three
runs, subject to complete citation evidence. Every other non-PR lane stays
unknown and KEEP, including PR-shaped aliases. Files are never candidates.

PR names without Z use local writer time; m1-procedure names without Z use
UTC, matching the procedure writer. Explicit Z always means UTC. Invalid or
future timestamps KEEP and take no retention slot. A present
`~/.golems/m1-procedure.lock` keeps the lane and aborts apply of any planned
lane candidate; the lock is rechecked immediately before each removal.

Citations and descendant writes within two hours always protect runs.
PR bodies, issue comments, review comments and summaries protect named paths
and SHA prefixes (head/producer); a 64-hex receipt hash alone does not pin.
For PR-only corpora the existing relevant/open PR fetch remains unchanged.
Only when an allowlisted non-PR run DIRECTORY exists, collect bodies from
all PRs, repo-wide issue comments and review comments, plus paginated
GraphQL PR review summaries. Run-shaped files do not trigger this path.

The non-PR path uses four gh invocations, with pagination within each:
pulls, issues/comments, pulls/comments, and GraphQL pullRequests/reviews.
For 1,201 PRs at 100/page that is 13 + I + C + 13 HTTP pages, where I and C
are repository issue/review-comment pages. With the review's I=22, C=1
snapshot this is about 49 requests, rather than ~3,616. This is a page-count
estimate, not a live timing or quota receipt. Tests assert four invocations
for 1,201 PRs. GraphQL totals and unique PR identities must match REST;
empty/short/duplicate/incomplete lists, GraphQL errors or truncated inner
review connections make all non-PR runs KEEP. No per-PR review calls occur
on this path. Any failed REST page or gh error aborts before mutation.

`--apply` explicitly removes candidates. It validates every candidate first,
then rechecks identity, size, latest descendant mtime, recency and procedure
lock immediately before each removal. Symlinks or filesystem errors stop
immediately. This is not an atomic snapshot or writer lock; stop writers
before applying. APFS snapshots can delay physical reclamation.

No real LIST or apply has run for this follow-up. The lead's M4 child owns
the first real LIST for orc. Mac rows and the final fix verification are
lead-routed. No new nightly wiring is introduced. Existing post-merge-live.sh
invocation remains; never invoke apply from a candidate pre-push/local-run.sh.
