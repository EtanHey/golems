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

Requires /opt/homebrew/bin/node, authenticated gh, and macbook-pro SSH alias.
Run offline checks with
`node --test scripts/fleet/ratchet-inbox-relay.test.mjs`.
