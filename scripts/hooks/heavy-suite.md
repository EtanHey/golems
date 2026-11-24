# Heavy suite queue

Opt in by replacing the suite command in each repository's pre-push hook (omit `GOLEMS_HEAVY_PRE_PUSH=1` in release hooks):

```sh
if command -v git >/dev/null; then unset $(git rev-parse --local-env-vars); fi; HS="$HOME/Gits/golems/.worktrees/hooks-live/scripts/hooks/heavy-suite.py"; if [ -f "$HS" ] && command -v python3 >/dev/null; then GOLEMS_HEAVY_PRE_PUSH=1 python3 "$HS" -- bun run test; else echo "heavy-suite: helper missing; running unqueued" >&2; bun run test; fi
```

Clear Git’s local environment first: inherited hook variables can redirect fixture commits into the real repository and alter its HEAD or `core.bare` config.

The helper comes from the installed, pinned hooks-live tree, moved only by
`install-hooks.mjs --apply --update`. There is no dev-checkout fallback.
Already opted-in repositories must update their hook line to use this path;
updating golems alone does not rewrite their hooks. `install-hooks.mjs --status`
reports helper availability without installing it.

Nightly worktree GC also runs the pinned hooks-live copy and refuses an unverified pin, logging its SHA.

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

Never wrap `install-hooks`, `post-merge-live` or `local-run` in an outer heavy-suite
lock or wrapper: they queue their own slots, so an outer lock can make them wait
on their own parent. Run them plainly (detached if needed).
`GOLEMS_HEAVY_SUITE_HELD` is only for `heavy-suite.py`'s own children; exporting
it is not a workaround, and the installer rejects it with
`run installer outside an existing heavy suite`.

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
releases its slot even if its child survives. INT/TERM/HUP trigger verified
tree cleanup. An inherited `GOLEMS_HEAVY_SUITE_HELD` marker makes nested
wrappers re-entrant. QUEUED / SUITE START / SUITE DONE log tokens and exit status
are preserved; START/DONE include the slot index. Keep fleet START/DONE posts
until all callers opt in; commands outside the wrapper, forced runs and expired
slot waits may overlap. Tests use synthetic homes, slots and commands.

Set `GOLEMS_HEAVY_PRE_PUSH=1` only in Git pre-push hooks. It reads Git's inherited stdin
before any scheduling gate: a nonempty list of valid ref lines with 40- or
64-zero local object IDs skips the suite with one notice. Empty or malformed
input and any real local object ID still run the suite. Hooks must leave stdin
unconsumed until this call. Release and other commands omit the variable, preserving
their stdin. Missing helper/Python retains the existing full-suite fallback.
Older installed helpers ignore the variable and keep running the full suite,
so source and caller PRs can land independently. The deletion skip becomes active
after the owner updates the installed pin; these source PRs do not install it.

Every launched command has an absolute execution budget: `--timeout-seconds` /
`GOLEMS_HEAVY_TIMEOUT_SECONDS` (1800 by default, finite and > 0), followed by
`--kill-grace-seconds` / `GOLEMS_HEAVY_KILL_GRACE_SECONDS` (10 by default,
finite and >= 0). CLI overrides environment. Invalid values return 2 before
launch, including FORCE, HELD and unqueued paths. Timeout returns 124; caught
INT/TERM/HUP return 130/143/129. Child errors retain their status. Cleanup failure
changes a successful command to 70; other failures remain primary.

The wrapper captures the leader's native birth identity before releasing its
exec gate. The launch trampoline remains the suite's group leader through
cleanup; it waits the actual command and reports its status over a private pipe.
The pipe descriptors are closed in the command. Signal authority comes **only**
from either:

- Membership in the suite's own process group observed while the suite leader
  was alive, with the leader's start time matching its captured identity.
- An observed lineage edge: a parent chain to the suite leader recorded by
  `proc_identity` while the parent incarnations were alive.

Cleanup also forwards to the new session's group before reaping its direct
child, whose unreaped PID prevents group-ID reuse. After reaping, only the
per-process identity checks may authorize signals. Darwin short-info hints can
mark unreadable same-group or observed-parent children incomplete during
cleanup; those hints never authorize an individual PID signal.

The environment marker may only narrow candidates; it never authorizes a
signal, even for a process born after suite start. A matching marker without
either authority is listed in `unattributed_marker_processes` as
"unattributed marker process (not signalled)" and makes cleanup incomplete.
It is never included among proven members or signal targets. Every recipient
is checked again immediately before TERM/KILL (Linux retains a pidfd). A reused
PGID, UID exclusions and unresolved identity evidence cannot establish cleanup.
Nested wrappers retain the root ID but clean only their observed inner tree;
they do not classify the root's other marker processes. Two empty observations
and a reaped child are required for successful cleanup. The slot is also
released after a bounded failed attempt; cleanup failure returns 70 only when
the command would otherwise succeed.

Private, atomic run records live in `~/.local/state/golems/runs/<suite_id>.json`;
terminal `<suite_id>.cleanup.json` receipts retain identities seen, signals,
survivors and incomplete evidence, without command/environment contents. The
active record is removed only after verified cleanup. Unreadable processes
outside the observed tree do not become members or signal targets. Known members
with unavailable identity prevent successful cleanup, even after disappearing:
they could have spawned an unobserved detached child. On Darwin, permission-denied
full BSD reads fall back to short BSD metadata bracketed by matching
`KERN_PROC_PID` birth timestamps. This covers transient setuid children such as
`/bin/ps` without an executable allowlist. Verified foreign-UID members prevent
successful cleanup while alive and remain excluded from individual signals;
their verified lifetimes still supply lineage for discovering descendants. A detached
branch escaping its original group before any lineage observation cannot be
signalled safely, even if it retains the marker. Wrapper SIGKILL, owner-exit supervision and inherited
root deadlines need A2; this change does not install a guardian or update hooks-live.

Nested cleanup failures additionally write private
`<suite_id>.inner-<wrapper_pid>-<birth_hash>.json` records in the same directory;
successful nested cleanup writes no record. The outer `SUITE DONE` notice adds
`inner_failures=<count> (see <directory>/<suite_id>.inner-*.json)` when present,
even if outer cleanup succeeds. All outer record operations (directory creation, START and terminal writes, and
successful-cleanup unlink), inner diagnostics writes and pointer discovery are
best-effort: exceptions preserve the command result. Outer record failures emit
at most one warning per wrapper run. Since #1118, a failed START write lets the
suite run instead of refusing with exit 70: nothing reads these records, and
cleanup decides from live process state. If a future guardian reads the active
record to find orphans, the START write must become fail-closed again.
Both outer records (including `.cleanup.json`) and inner records cap diagnostic
lists and dictionaries at 200 entries, with `<field>_total` retaining the original
size. Collections longer than 200 keep the first 100 and last 100 entries
(in insertion order for dictionaries); shorter collections remain intact.
Identity-reason lists per retained PID are also capped at 200, with counts
in `identity_unavailable_reasons_totals`. Caps affect stored diagnostics only,
never cleanup decisions. The existing inner `members_seen_count` remains available.

## Memory watchdog (`heavy-run`)

After updating the pinned hooks-live tree, run
`python3 scripts/hooks/install-heavy-run.py` to install `~/.local/bin/heavy-run`.
Use `heavy-run [--limit-gb 8] [--lane NAME] -- bun test` (or `bun run check`,
or a proof command). `heavy-run` selects lane mkdir admission (`--lane-slots`)
in place of the heavy-suite flock slots. M1 uses `~/.m1-heavy.lock`; M4 tries
`~/.m4-heavy.lock`, then `~/.m4-heavy-2.lock`. Host detection reads macOS
`machdep.cpu.brand_string` (Apple M1 / Apple M4); unknown Macs refuse admission.
Non-Darwin uses the conservative one-slot M1 layout in HOME.

Before each acquisition sweep, M4 runs `~/.local/bin/m4-heavy-gate --quiet`
when present. Nonzero results (including 1 WAIT and 2 unmeasurable), execution
errors and gate timeout all wait/refuse; no lock is held during the gate.
Missing gate is logged; admission then relies on the slot alone. Lane admission
uses neither the heavy-suite RAM floor nor its load gate. The 8 GiB runtime
watchdog remains active. `--max-wait` (alias `--max-wait-seconds`, default 1800)
bounds the whole admission, including the pressure gate; expiry returns 75 and
never starts unqueued. WAIT notices repeat every 30 seconds.

Immediately after mkdir, each acquired directory receives a private file named
exactly `owner`. It has six `key=value` lines: `lane=`, `worker=`, `start=`
(ISO 8601 UTC), `pid=`, `token=`, and `cmd=` (shell-quoted command).
`GOLEMS_HEAVY_WORKER` supplies the worker identity, defaulting to `heavy-run:<pid>`.
Backslashes and CR/LF inside values are escaped, keeping one field per line.
A directory without `owner` stays foreign; no timestamp or PID permits reclaim. Took/released entries append to
`~/.m1-heavy.log` or `~/.m4-heavy.log` in the existing `<lane> took HH:MM` /
`<lane> released HH:MM` format. Release requires the original directory inode,
owner-file inode, PID and token, and uses nonrecursive rmdir. Foreign, ownerless,
replaced or nonempty directories are never reclaimed. Catchable INT/TERM/HUP,
normal/nonzero exit and watchdog cleanup release the owned slot. SIGKILL or a
host crash cannot clean a mkdir slot: inspect its ownership before manual repair.
Like the lanes' mkdir protocol, this assumes cooperating same-user writers;
concurrent malicious renaming between ownership verification and rmdir is not
an atomic filesystem fencing guarantee.

There is never a nested lane/flock acquisition. Heavy-run refuses inherited
`GOLEMS_HEAVY_SUITE_HELD` ownership, and refuses FORCE. Ordinary heavy-suite
children under heavy-run inherit the existing HELD marker and reuse admission.
Direct heavy-suite callers (even with `--limit-gb`) retain flock admission.
GC retains its exclusive heavy-suite lock and never takes a lane slot; heavy-run
never takes heavy-suite.lock, so these paths cannot deadlock. Consequently this
change does **not** exclude GC from lane workloads; GC still excludes the
ordinary heavy-suite participants. Keep installer/GC coordination separate.

The trampoline starts a new session. It handles TERM/INT/HUP until the wrapper
finishes TERM, up to a five-second grace (ending early when only the leader
remains), and KILL to its process group, then reaps it.
The unreaped direct child reserves its PID/group ID; processes outside its
session cannot join. Watchdog cleanup never signals individual PIDs or other
groups. An already-reaped leader is refused. Catchable wrapper signals use the
same cleanup. For direct heavy-suite flock callers, SIGKILL releases kernel
descriptors; heavy-run mkdir slots instead remain for operator inspection.

Memory is summed about every two seconds from observed descendants, retaining
birth identities across reparenting. Darwin uses `proc_pid_rusage` with
`RUSAGE_INFO_V2.ri_phys_footprint` through ctypes; same-uid observation needs no
task-port entitlement. This counts physical footprint including compressed and
swapped accounting. If a per-PID call fails, that PID falls back to RSS from
`ps`; Linux uses RSS throughout. Alarm lines list the metrics actually used
(`phys_footprint`, `rss_fallback`, `rss`). Fallback RSS can undercount under
memory pressure and can double count shared pages.

At threshold, one line goes to the Mac's heavy log (Linux: `~/.heavy-run.log`)
with lane, metric, total GiB, and the top process executable name. If log writing
fails, the alarm is printed to stderr and the threshold exit code is retained.
Exit 125 denotes a memory limit; 126 denotes `ALARM unkillable escapee` when any
measured member is outside the owned group. Both kill only the owned group.
Escapees are NEVER signaled.
A tracked escapee may exit before cleanup; its alarm still stands. Normal command
exit codes pass through (so a command may itself return 125/126; use the log to
disambiguate). Cleanup uncertainty changes successful exit to 70.

Tracking is best effort: an escapee that detaches and reparents between scans
before ever being observed may escape measurement. Processes in the session can
create other groups; their memory counts when observed, but only the original
group is signaled. Alarm handling requires an operator; this is not a sandbox.
Logging includes commands, so avoid secrets in command arguments.
