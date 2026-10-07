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

By default, opted-in commands for the same OS user share three slots:
`~/.local/state/golems/heavy-suite.slot{0,1,2}.lock`.
`GOLEMS_HEAVY_SUITE_SLOTS` changes capacity (clamped to 1..8; invalid input uses 3).
Configure the same capacity for all participants. `GOLEMS_HEAVY_LOCK` remains a
namespace override: `/path/suite.lock` produces `/path/suite.slot0.lock`, etc.
Different users must configure the same accessible namespace to share a queue.
Kernel ownership is authoritative; stale PID metadata is replaced. Never delete
slot files: a new inode could allow overlap. Each new holder also holds LOCK_SH
on the legacy `heavy-suite.lock` namespace file. Shared legacy locks allow new holders to coexist and exclude old LOCK_EX
holders in both directions, so pin updates need no fleet drain. The new helper
does not rewrite legacy metadata while holding a shared lock.
The private regression installer gate uses this same semaphore; the ratchet's
`GOLEMS_HEAVY_LOCK` override continues to select the real user's namespace.

Before acquiring a slot, the wrapper waits until free + inactive RAM reaches
6 GiB. `GOLEMS_HEAVY_MIN_FREE_GB` / `--min-free-gb` changes this floor (0 disables
it). macOS uses `vm_stat`; Linux uses `/proc/meminfo`. Memory is checked again
after the load wait, before acquiring any slot or legacy lock. Unavailable memory data or expiry
below the floor returns 75 without starting the suite.

Before acquiring a slot or legacy lock, the wrapper waits while uptime's
1-minute load exceeds twice the CPU count. No load/RAM wait holds either lock.
`GOLEMS_HEAVY_MAX_LOAD` / `--max-load` changes the threshold;
`GOLEMS_HEAVY_POLL_SECONDS` / `--poll-seconds` changes the 5-second poll interval.
WAIT logs are throttled to 30 seconds and show slot holders or the RAM deficit.
`GOLEMS_HEAVY_MAX_WAIT_SECONDS` / `--max-wait-seconds` sets one budget for slot,
memory and load waits (default 1800 seconds). Slot expiry proceeds unqueued with
a LOUD warning; load expiry proceeds to slot acquisition. The memory floor
still applies. The private installer gate uses the same CPU-based default and
load environment override, but refuses slot/load expiry as before.
`GOLEMS_HEAVY_FORCE=1` explicitly bypasses all scheduling gates with a warning.
Missing helper/Python or unusable slot setup runs the original suite unqueued;
where the helper is available, the memory floor still applies. A broken suite
command or failing suite still fails the hook.

Slot and legacy descriptors are O_CLOEXEC and non-inheritable; only the wrapper
holds them.
Children and detached descendants receive no slot fd. SIGKILL of the wrapper
releases its slot even if its child survives. INT/TERM/HUP are forwarded to the
child's process group. An inherited `GOLEMS_HEAVY_SUITE_HELD` marker makes nested
wrappers re-entrant. QUEUED / SUITE START / SUITE DONE log tokens and exit status
are preserved; START/DONE include the slot index. Keep fleet START/DONE posts
until all callers opt in; commands outside the wrapper, forced runs and expired
slot waits may overlap. Tests use synthetic homes, slots and commands.
