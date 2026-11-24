# Run tests and proofs with a memory watchdog

Update the pinned hooks-live tree, then run `python3 scripts/hooks/install-heavy-run.py`.
Use `heavy-run --lane my-proof -- bun test`, `heavy-run -- bun run check`, or
`heavy-run --limit-gb 8 -- your-proof-command`.

**Never run `heavy-run` while holding a lane mkdir lock yourself; `heavy-run` IS
the lane lock now.** Wrapping it in your own lock takes both M4 slots or waits
until `--max-wait` expires on M1 (1800 seconds by default).

The watchdog takes exactly one lane mkdir slot: M1 uses `~/.m1-heavy.lock`;
M4 tries `~/.m4-heavy.lock`, then `~/.m4-heavy-2.lock`. Before each slot
sweep on M4 it runs `~/.local/bin/m4-heavy-gate --quiet` if present; only exit 0
admits. Missing gates are recorded in the heavy log and stderr; admission relies on the slot alone.
`--max-wait 1800` bounds admission; expiry refuses execution (75).

It sums Darwin physical footprint (per-PID RSS fallback) or Linux RSS every two seconds and
terminates only its new session's original process group on limit. Observed
escapees count toward the limit but are never signaled: they produce an
`ALARM unkillable escapee` log and exit 126. Group memory limits exit 125.
Unobserved escapees can evade measurement. RSS fallback may undercount compressed/swapped memory.
Each acquired slot immediately receives `owner` with `lane`, `worker`, ISO UTC
`start`, `pid`, `token` and `cmd` as separate `key=value` lines.
Set `GOLEMS_HEAVY_WORKER` for a named worker (default `heavy-run:<pid>`).
The wrapper never reclaims a foreign slot or one missing `owner`. Its own slot is released
after command exit or catchable signal cleanup; wrapper SIGKILL leaves a stale
mkdir slot requiring operator inspection. It never also takes a heavy-suite flock.

See [the complete contract](../scripts/hooks/heavy-suite.md#memory-watchdog-heavy-run)
for ownership, log paths, lane admission, and limitations.
