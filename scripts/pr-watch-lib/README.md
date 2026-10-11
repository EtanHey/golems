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

Run `scripts/pr-watch owner/repo 42 --head <full-sha> --deadline 2h`.
The deadline defaults to two hours; durations accept ms, s, m, or h.
Each invocation emits exactly one terminal JSON line with `event`, pinned `sha`,
`repo`, and `pr`. Polls emit nothing. GitHub errors go to stderr verbatim.

| Code | Event | Meaning |
|---|---|---|
| 0 | READY | Open PR on the pinned head with nonempty latest checks all green |
| 10 | FAILED | A latest failed check on an open PR, or PR closed without merging |
| 11 | HEAD_MOVED | Head differs; re-arm with the new head |
| 12 | MERGED | PR already merged on the pinned head; `checks` reports its CI verdict |
| 20 | DEADLINE | Deadline reached, including while gh is blocked |
| 30 | GH_ERROR | gh failed after the retry budget, malformed data, or state I/O failed |

Usage errors exit 2; Ctrl-C exits 130. These emit no terminal JSON.
READY is a CI fact, not merge authorization. Review decision is reported as a
fact; bot coverage, review threads, late checks, required-check manifests,
and settle windows belong to later slices.
Checks, workflow runs, workflow jobs, and legacy commit statuses are paginated
with 100 rows per page. Only the latest check per app ID plus name plus workflow, and latest
legacy status per context, counts. Numeric IDs order queued reruns before they
have start timestamps; timestamps break ties or order rows without IDs.
Jobs are read for the latest run of each workflow; older check runs still undergo
per-check deduplication. The newest run of every workflow also contributes its
own status/conclusion: unfinished runs remain pending even with partial green
jobs, and completed startup failures count even without jobs.
Each poll costs one PR read, checks/runs/statuses pages, and one jobs read per
latest workflow plus extra pages (100 rows/page); terminal results add a PR confirmation read.
Terminal PR observations include `checks`: `green`, `failed`, `pending`, or
`unknown` when no check snapshot was read (e.g. HEAD_MOVED or CLOSED).
MERGED is distinct from READY, even when checks are green. Null review decisions
are emitted as an empty string. A second PR read confirms the head and state
before READY, FAILED, or MERGED is emitted.
SUCCESS, NEUTRAL, and SKIPPED are green; unknown or pending checks keep waiting.
The command never merges, reruns checks, or writes to GitHub.

`--poll-seconds` defaults to 30. `--max-gh-retries` defaults to 3: API errors
use exponential backoff capped at five minutes, then exit GH_ERROR. Every
failed invocation's stderr is forwarded unchanged. Retry counts persist per
head across restarts; a healthy poll resets that head's consumed budget to zero.
State defaults to `~/.local/state/golems/pr-watch/<owner>/<repo>/<pr>-<sha>.json`;
`--state-file` overrides it. Atomic writes retain the upstream state format.
Use one watcher per PR/head/state file; concurrent writers are unsupported.
The deadline bounds gh subprocesses as well as sleeps.

Run fixtures: `python3 -m unittest discover -s scripts/tests -p test_pr_watch.py`.
