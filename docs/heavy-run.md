# Run tests and proofs with a memory watchdog

Update the pinned hooks-live tree, then run `python3 scripts/hooks/install-heavy-run.py`.
Use `heavy-run --lane my-proof -- bun test`, `heavy-run -- bun run check`, or
`heavy-run --limit-gb 8 -- your-proof-command`.

The watchdog shares heavy-suite admission. It sums Darwin physical footprint (per-PID RSS fallback) or Linux RSS every two seconds and
terminates only its new session's original process group on limit. Observed
escapees count toward the limit but are never signaled: they produce an
`ALARM unkillable escapee` log and exit 126. Group memory limits exit 125.
Unobserved escapees can evade measurement. RSS fallback may undercount compressed/swapped memory. Until lanes migrate,
heavy-run does NOT serialize against the historical `~/.m4-heavy.lock` /
`~/.m1-heavy.lock` mkdir gate.

See [the complete contract](../scripts/hooks/heavy-suite.md#memory-watchdog-heavy-run)
for ownership, log paths, migration from historical mkdir gates, and limitations.
