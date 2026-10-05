# Heavy suite queue

Opt in by replacing the suite command in each repository's pre-push/release hook:

```sh
if command -v git >/dev/null; then unset $(git rev-parse --local-env-vars); fi; HS="$HOME/Gits/golems/.worktrees/hooks-live/scripts/hooks/heavy-suite.py"; if [ -f "$HS" ] && command -v python3 >/dev/null; then python3 "$HS" -- bun run test; else echo "heavy-suite: helper missing; running unqueued" >&2; bun run test; fi
```

Clear Git’s local environment first: inherited hook variables can redirect fixture commits into the real repository and alter its HEAD or `core.bare` config.

The helper comes from the installed, pinned hooks-live tree, moved only by
`install-hooks.mjs --apply --update`. There is no dev-checkout fallback.
Already opted-in repositories must update their hook line to use this path;
updating golems alone does not rewrite their hooks. `install-hooks.mjs --status`
reports helper availability without installing it.

Replace `bun run test` in both branches with that repository's existing suite.
For the skill suite, use `bash scripts/ci/run-skill-tests.sh`, retaining its environment requirements
(including isolated TMP_BLOCK_LEDGER). This wrapper installs no hooks itself.

By default, opted-in commands for the same OS user share
`~/.local/state/golems/heavy-suite.lock`. Use `GOLEMS_HEAVY_LOCK` for an explicit
shared path (or an isolated test path). Different users must configure the same
accessible path to share a queue. Kernel ownership is authoritative; stale PID
metadata is replaced. Never delete the lock file: a new inode could allow overlap.

After acquiring the lock, the wrapper waits while uptime's 1-minute load exceeds
20. `GOLEMS_HEAVY_MAX_LOAD` / `--max-load` changes the threshold;
`GOLEMS_HEAVY_POLL_SECONDS` / `--poll-seconds` changes the 5-second poll interval.
WAIT logs are throttled to 30 seconds and show the holder PID/executable/start.
`GOLEMS_HEAVY_MAX_WAIT_SECONDS` / `--max-wait-seconds` sets one budget for lock
and load waits (default 1800 seconds). Expiry proceeds with a LOUD warning;
lock expiry runs unqueued, load expiry runs while retaining its acquired lock.
`GOLEMS_HEAVY_FORCE=1` explicitly bypasses both with a warning. Missing helper,
Python, or unusable lock setup runs the original suite unqueued; a broken suite
command or failing suite still fails the hook. This is scheduling, not a policy gate.

The child inherits the descriptor, keeping its slot if the wrapper is SIGKILL'd.
Normal completion explicitly unlocks before close, so surviving daemons cannot
keep the queue held. INT/TERM/HUP are forwarded to the child's process group.
An inherited `GOLEMS_HEAVY_SUITE_HELD` marker makes nested wrappers re-entrant.
The wrapper preserves suite exit status. Keep fleet START/DONE posts until all
callers opt in; commands outside the wrapper, forced runs and expired waits may
overlap. Tests use synthetic homes, locks and commands, never a real full suite.
