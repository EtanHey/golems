# Upstream attribution

`vendor/upstream.py` retains the named helper functions verbatim from OpenAI Codex
`.codex/skills/babysit-pr/scripts/gh_pr_watch.py` in the local codex-api recon.
Source SHA-256: `44209907eda7bd84d82c5453c6a971d68547e878c14ed0037f0a2cda8f854d33`.

The subset retains paginated API reads, atomic state-file writes, per-head
retry counters, and bot/human classification. The golems entry point supplies
`gh_json`; it rewrites CLI, errors, readiness, loop, and terminal output.
Review classifiers and pagination are available for later slices and do not
add review or pagination guarantees to slice (i). vendor/LICENSE and vendor/NOTICE are copied
unchanged from the upstream repository.

## Usage and exits

Run `scripts/pr-watch owner/repo 42 --head <full-sha> --deadline 2h`.
The deadline defaults to two hours; durations accept ms, s, m, or h.
Each invocation emits exactly one terminal JSON line with `event`, pinned `sha`,
`repo`, and `pr`. Polls emit nothing. GitHub errors go to stderr verbatim.

| Code | Event | Meaning |
|---|---|---|
| 0 | READY | Open PR on the pinned head with a nonempty observed green rollup |
| 10 | FAILED | A failed check, or PR closed/merged |
| 11 | HEAD_MOVED | Head differs; re-arm with the new head |
| 20 | DEADLINE | Deadline reached, including while gh is blocked |
| 30 | GH_ERROR | gh failed after the retry budget, malformed data, or state I/O failed |

Usage errors exit 2; Ctrl-C exits 130. These emit no terminal JSON.
READY is a CI fact, not merge authorization. Review decision is reported as a
fact; bot coverage, review threads, late checks, required-check manifests,
settle windows, and checks/runs/jobs pagination belong to later slices.
SUCCESS, NEUTRAL, and SKIPPED are green; unknown or pending checks keep waiting.
The command never merges, reruns checks, or writes to GitHub.

`--poll-seconds` defaults to 30. `--max-gh-retries` defaults to 3: API errors
use exponential backoff capped at five minutes, then exit GH_ERROR. Every
failed invocation's stderr is forwarded unchanged. Retry counts persist per
head across restarts; a healthy poll does not reset the consumed budget.
State defaults to `~/.local/state/golems/pr-watch/<owner>/<repo>/<pr>-<sha>.json`;
`--state-file` overrides it. Atomic writes retain the upstream state format.
Use one watcher per PR/head/state file; concurrent writers are unsupported.
The deadline bounds gh subprocesses as well as sleeps.

Run fixtures: `python3 -m unittest discover -s scripts/tests -p test_pr_watch.py`.
