# Machine-wide heavy suite queue

Wrap the full-suite command in each repository's pre-push or release hook:

```sh
python3 "$HOME/Gits/golems/scripts/hooks/heavy-suite.py" -- bun run test
```

Replace `bun run test` with that repository's existing full-suite command. This
is an opt-in wrapper; it does not install or modify another repository's hooks.
Golems has no tracked pre-push hook. Its package suite can use the same command;
the skill suite uses `...heavy-suite.py -- bash scripts/ci/run-skill-tests.sh`.

All opted-in commands share `~/.local/state/golems/heavy-suite.lock`. A waiting
command acquires the advisory lock, then waits while the 1-minute load (the same
value shown by `uptime`) exceeds 20. Set `GOLEMS_HEAVY_MAX_LOAD` or `--max-load`
for a different threshold; `GOLEMS_HEAVY_POLL_SECONDS` / `--poll-seconds` controls
the load check interval (default 5 seconds). Lightweight targeted tests need not
use the wrapper. It cannot serialize commands that have not opted in.

The kernel releases a dead owner's lock; the next holder replaces its stale
record. PID metadata is informational. Never delete the lock file, even when
it looks stale: unlinking would create two independently locked inodes. The
suite child inherits the descriptor so wrapper death does not free the slot
while that child still runs. SIGINT/SIGTERM are forwarded to its process group.
The wrapper preserves command exit status and prints SUITE START/DONE receipts.

Wrap the suite itself, rather than an entire release script that invokes a
wrapped pre-push hook; nesting wrappers would wait on the outer lock. Keep the
fleet collab START/DONE posts until all full-suite callers have opted in. Existing
suite environment requirements (including TMP_BLOCK_LEDGER test isolation) still
apply. Tests use synthetic HOME and child commands, not real suites.
