# Upstream attribution

`vendor/upstream.py` retains the named helper functions verbatim from OpenAI Codex
`.codex/skills/babysit-pr/scripts/gh_pr_watch.py` in the local codex-api recon.
Source SHA-256: `44209907eda7bd84d82c5453c6a971d68547e878c14ed0037f0a2cda8f854d33`.

The subset retains paginated API reads, atomic state-file writes, per-head
retry counters, and bot/human classification. The golems entry point supplies
`gh_json`; it rewrites CLI, errors, readiness, loop, and terminal output.
The entry point adapts REST list envelopes to the vendored pagination helper.
Review classifiers remain available for later slices. vendor/LICENSE and vendor/NOTICE are copied
unchanged from the upstream repository.

## Usage and exits

Run `scripts/pr-watch owner/repo 42 --head <full-sha> --deadline 2h --settle 180s`.
The deadline defaults to two hours and settle to 180 seconds; both accept positive
durations in ms, s, m, or h.
Each invocation emits exactly one terminal JSON line with `event`, pinned `sha`,
`repo`, and `pr`. Polls emit nothing. GitHub errors go to stderr verbatim.

| Code | Event | Meaning |
|---|---|---|
| 0 | READY | Open PR on the pinned head with required contexts present and all latest checks green for the settle window |
| 10 | FAILED | A latest failed check on an open PR, or PR closed without merging |
| 11 | HEAD_MOVED | Head differs; re-arm with the new head |
| 12 | MERGED | PR already merged on the pinned head; `checks` reports its CI verdict |
| 20 | DEADLINE | Deadline reached, including while gh is blocked |
| 30 | GH_ERROR | gh failed after the retry budget, malformed data, or state I/O failed |

Usage errors exit 2; Ctrl-C exits 130. These emit no terminal JSON.
READY is a CI fact, not merge authorization. Review decision is reported as a
fact; bot coverage and review threads are not readiness blockers.
Required contexts come from the PR base branch's active rules, read from the
paginated `repos/{owner}/{repo}/rules/branches/{branch}` API. If those rules contain
no required contexts, the watcher reads classic `branches/{branch}/protection`.
The classic-protection read needs admin rights. A 404 whose JSON message is
`Branch not protected` means an empty required manifest; every other nonzero
response, including 403 or any other 404, follows the GH_ERROR retry path.
App bindings (`integration_id` or `app_id`) are honored when present. A missing
required context stays pending until DEADLINE. Merged PRs report their observed
check verdict without applying today's branch requirements retroactively.

An empty rollup is never READY. The quiet window starts at the first all-green
snapshot. New checks, jobs, workflow runs or run attempts reset it, as do a
pending poll or an API error. The required manifest is fetched
once per unchanged green settle window; window resets and base changes discard
the cache. Requirement changes during that window are observed on the next fetch.
Consecutive pending polls also share a manifest, refreshed when checks turn green.
Completion alone does not register a new check. Restarting the watcher starts
a fresh quiet window. This bounds
readiness to observed registrations; a check can still register after READY.
Checks, workflow runs, workflow jobs, and legacy commit statuses are paginated
with 100 rows per page. Only the latest check per app ID plus name plus workflow, and latest
legacy status per context, counts. Numeric IDs order queued reruns before they
have start timestamps; timestamps break ties or order rows without IDs.
Jobs are read for the latest run of each workflow; older check runs still undergo
per-check deduplication. The newest run of every workflow also contributes its
own status/conclusion: unfinished runs remain pending even with partial green
jobs, and completed startup failures count even without jobs.
Each open-PR poll costs one PR read, checks/runs/statuses pages, and one jobs
read per latest workflow plus extra pages (100 rows/page); terminal results
add a PR confirmation read.
An uncached required-manifest read adds branch-rules pages and classic protection
when needed.
Terminal PR observations include `checks`: `green`, `failed`, `pending`, or
`unknown` when no check snapshot was read (e.g. HEAD_MOVED or CLOSED).
MERGED is distinct from READY, even when checks are green. Null review decisions
are emitted as an empty string. A second PR read confirms the head and state
before READY, FAILED, or MERGED is emitted.
SUCCESS, NEUTRAL, and SKIPPED are green; unknown or pending checks keep waiting.
The command never merges, reruns checks, or writes to GitHub.

`--poll-seconds` defaults to 30. `--max-gh-retries` defaults to 3: API errors
use exponential backoff capped at five minutes, then exit GH_ERROR. Every
failed invocation's stderr is forwarded unchanged, except for the expected
`Branch not protected` 404 handled above. Retry counts persist per
head across restarts; a healthy poll resets that head's consumed budget to zero.
State defaults to `~/.local/state/golems/pr-watch/<owner>/<repo>/<pr>-<sha>.json`;
`--state-file` overrides it. Atomic writes retain the upstream state format.
Use one watcher per PR/head/state file; concurrent writers are unsupported.
The deadline bounds gh subprocesses as well as sleeps.

Run fixtures: `python3 -m unittest discover -s scripts/tests -p test_pr_watch.py`.
