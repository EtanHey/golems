# Ratchet inbox relay

Hourly M1 relay for orc's order: alert on new red causes, remind daily, clear once,
and warn 48 hours before report-only expiry. Uses ambient gh and batch SSH;
no credentials are written. `node scripts/fleet/ratchet-inbox-relay.mjs --dry-run`
fetches origin/master and prints due/pending posts without delivering or changing state.

State is outside the checkout at ~/.golems/ratchet/inbox-relay-state.json.
Pending posts are persisted before delivery; failed SSH appends a local OUTBOX copy
and retries from state next hour. OUTBOX is an audit fallback, not a second queue.
An ambiguous remote failure or crash after append can duplicate a post (at least once).
Locks older than 90 minutes are recovered automatically and reported in the next post;
younger locks skip the run. Consecutive failed runs are counted in state. After three
or more failures, the first successful run reports the count, start time and safe stage name. Failures never echo command stderr.
The first-observed time is local; the original scheduled run URL is retained.

Copy ratchet-relay.example.json to ~/.config/golems/ratchet-relay.json and set
sshHost, remoteInbox and localOutbox for the operator environment. Config must stay
outside the repository. Missing or invalid config fails the run and increments self-health.

After merge, the lead installs on the designated runner from its updated root checkout:

```sh
mkdir -p "$HOME/.golems/ratchet" "$HOME/Library/LaunchAgents"
sed "s|__HOME__|$HOME|g" scripts/fleet/com.golems.ratchet-inbox-relay.plist.template > "$HOME/Library/LaunchAgents/com.golems.ratchet-inbox-relay.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.golems.ratchet-inbox-relay.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.golems.ratchet-inbox-relay.plist"
```

Requires /opt/homebrew/bin/node, authenticated gh, and an ssh host configured in ratchet-relay.json.
Run offline checks with
`node --test scripts/fleet/ratchet-inbox-relay.test.mjs`.

## Worktree sweeper and disk guard

Both run hourly via the adjacent launchd templates. The separate guarded hook
installer integration installs and drift-checks these jobs; do not copy configs
from a checkout. Neither job needs an LLM or a scheduled agent session.

The existing relay config may additionally contain `repoRoots` (absolute paths)
and `diskThresholdGiB` (hostname to positive GiB threshold). Defaults scan
~/Gits and ~/.t3/worktrees; volumes below 1000 GiB default to 40 GiB, larger
volumes to 60 GiB. Free space uses statfs bfree, excluding purgeable estimates.
Largest immediate child directories are reported with deltas from the last
successful scan; a first observation has UNKNOWN delta. du errors fail the run.

Sweeping fetches origin before eligibility checks, protects root/locked trees,
hidden index flags, detached trees, missing upstream/default refs, dirty files,
unpushed commits and ignored data outside docs.local and configured output directories.
Only ignored, entirely untracked output directories are pruned after 12 idle
hours. Removal also requires 12 quiet hours and the latest branch PR to be merged,
with HEAD equal to or an ancestor of its recorded head SHA. Default-branch
ancestry alone never admits removal; pruned upstream refs do not block a proven merge.
Merged trees first use the shared closeout archive and stack checks described below.
Open stacks retain source/docs; quiet, inactive regenerable output may still be cleaned.
The PR list is fetched once per repository per sweep, using paginated NDJSON
(`gh api --paginate --jq`, without `--slurp`) before local admission checks.
No force removal. Freshness is a full recursive mtime scan without symlink
traversal. Git state is rechecked immediately before deletion. This does not
fence an external process starting a write after that check: rollout requires
the lead to assess this remaining concurrency limitation before enabling.
Untracked ignored build contents are treated as regenerable by contract.

State, locks, logs and default OUTBOX live under ~/.golems/fleet. Missing config
still collects alerts into OUTBOX and returns exit 1. Pending posts retry until
SSH succeeds (ambiguous delivery can duplicate). Self-health failures are counted
and logged. Locks older than 90 minutes are recovered and reported in the next post.
The first successful delivery after three or more consecutive failures reports
the failed-run count once. Replacement locks are preserved by inode checks. OUTBOX is an audit copy, not a separate queue.

Offline verification: `node --test scripts/fleet/cleanup.test.mjs scripts/fleet/ratchet-inbox-relay.test.mjs`.
Fixtures use real local repositories under ignored docs.local and remove only
their own test directories. No production sweep/install is part of this test.
## Worktree closeout

Run `node scripts/fleet/worktree-closeout.mjs <worktree-path> --json` to close a
registered linked checkout. Root checkouts, locked worktrees, dirty state and
commits without pushed or merged-PR coverage are refused. Fetch remote
refs before using this tool when freshness matters. Removal queries GitHub PR state
with authenticated `gh api`; unavailable or invalid PR state refuses removal.

Closeout keeps a clean pushed unmerged worktree without error. Removal requires
a merged latest PR, matching/contained HEAD, 12 quiet hours, safe output preflight
and no live process cwd/open files under the path. Before removal it copies its untracked
`docs.local/**` into the primary checkout's ignored
`docs.local/worktree-archive/<encoded-branch>/`, verifies each file's SHA-256 and
size and rechecks the full source inventory, then unlinks the originals. Tracked
files are never moved. A sibling `.receipt.json` records HEAD, paths, sizes and
hashes plus PR number, branch, head SHA, worktree path and thread id if known.
Copies and the manifest are fsynced and read back before unlinking. The single
`archiveConvention` policy in worktree-preservation.mjs controls destination and manifest fields. Existing destinations get `-2`, `-3`, etc.;
the receipt reports the collision. Symlinks, special files, nested repositories
and unsafe archive directories refuse archival. No files means no archive.

The complete paginated PR history identifies open descendants (even through
merged intermediate PRs) and an unmerged non-default base. Any open stack keeps
the tree and prints `kept: stack <PRs> open`; a closed unmerged or unknown base
also retains it. Once the full stack merges, ordinary quiet closeout applies.
The sweeper and CLI remove only PR-proven merged trees. The sweeper uses the same archival path.
Receipts report moved file count/bytes, destination, removal and registration
absence proof. Git state is rechecked before removal; external writers remain
subject to the concurrency limitation above. This is local preservation, not a
Brain Drive upload or native rollout receipt.

Build directories are removed recursively by basename, without following
symlinks. The defaults are `.build.noindex`, `node_modules`, `.test-tmp`, `dist`,
`.build`, `target`, `__pycache__`, `.next`, and `.venv`. A worktree-local
`.golems-closeout.json` can add names with `{"outputs":["build-cache"]}`.
Tracked files and nested repositories in those directories cause refusal.
The receipt reports logical file bytes removed, not APFS physical space reclaimed.

`<path> --keep "review pending"` cleans build output and retains the checkout.
The reason is stored in the common Git directory, keyed by checkout, HEAD and
status; a changed HEAD or dirty status invalidates it. Keep is an explicit
exception for dirty or unpushed worktrees too. It does not alter their source.

`--triage <repo> --json` lists all registered worktrees, their state, commit and
filesystem timestamps, logical size, branch and retained reason. Dirty takes
precedence over unpushed; both booleans remain visible. Exit 3 means at least one
unresolved dirty/unpushed worktree has both timestamps older than 48 hours.
An unavailable checkout also needs resolution. Offline triage leaves clean
remote-covered work as pushed-clean: it does not fetch PR rows or infer merged
from default-branch ancestry.

`--bundle <worktree-path>` snapshots HEAD/all refs into a verified Git bundle,
a binary HEAD diff, untracked non-ignored files and a receipt in primary docs.local.
It retains the worktree and dirty source state; removal uses ordinary merged/quiet
admission separately. Other ignored private files refuse ordinary CLI removal,
using the same full inspect() as the sweeper. Output preflight runs before any
note moves; final full inspection runs after output cleaning, then preserveDocs
runs immediately before non-force removal. Branch deletion is non-force only.

## Sweeper enable assessment (lead gate, no enablement by this change)

Recursive `lsof +D` checks cwd/open file references before mutation; no matches
must be a complete successful scan. Errors/timeouts retain the tree. It scans
files and process descriptors, up to 60 seconds per call: twice for removal,
once for output-only cleanup. Large trees may make that cost material. The
snapshot does not fence a writer starting afterwards; quiet age is not a lease.
Before enabling, the lead must verify ownership/consumer/session releases and
managed-root policy, prevent new writers through the removal interval, approve
the archive destination/custody convention and capacity/fsync support, verify
correct authenticated GitHub repository resolution and fresh refs/PR evidence,
and obtain routed review, M4 Mac-table and installed-job receipts. This PR does
not install or enable the hourly job. The default gh repository may resolve to a
fork parent (review m5); a failed copy can leave an unreceipted partial archive
that the next attempt suffixes (m6). Both remain assessment limitations.

Tests: `node --test scripts/fleet/worktree-closeout.test.mjs` (real temporary Git
repositories and a local bare remote, no network or credentials).
Run `node --test scripts/fleet/*.test.mjs`; GitHub PR
and stack responses are raw API pages: the fixture checks gh argv and runs real jq.
Tests cover all merge strategies, deleted remote branches, fresh/no-PR retention,
network and cleanup interleavings, lsof holds, caching and fsync failure.
