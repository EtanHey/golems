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
unpushed commits and ignored data outside the five named output directories.
Only ignored, entirely untracked output directories are pruned after 12 idle
hours; clean pushed merged worktrees can be removed without the idle delay.
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
