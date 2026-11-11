# Ratchet inbox relay

Hourly M1 relay for orc's order: alert on new red causes, remind daily, clear once,
and warn 48 hours before report-only expiry. Uses ambient gh and batch SSH;
no credentials are written. `node scripts/fleet/ratchet-inbox-relay.mjs --dry-run`
fetches origin/master and prints due/pending posts without delivering or changing state.

State is outside the checkout at ~/.golems/ratchet/inbox-relay-state.json.
Pending posts are persisted before delivery; failed SSH appends a local OUTBOX copy
and retries from state next hour. OUTBOX is an audit fallback, not a second queue.
An ambiguous remote failure or crash after append can duplicate a post (at least once).
A crash while holding the exclusive .lock file requires an operator to confirm no
relay process remains before removing that lock. Failures never echo command stderr.
The first-observed time is local; the original scheduled run URL is retained.

After merge, the lead installs ONLY on M1, from its updated root checkout:

```sh
mkdir -p "$HOME/.golems/ratchet" "$HOME/Library/LaunchAgents"
sed "s|__HOME__|$HOME|g" scripts/fleet/com.golems.ratchet-inbox-relay.plist.template > "$HOME/Library/LaunchAgents/com.golems.ratchet-inbox-relay.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.golems.ratchet-inbox-relay.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.golems.ratchet-inbox-relay.plist"
```

Requires /opt/homebrew/bin/node, authenticated gh, and macbook-pro SSH alias.
Do not install on M4. Run offline checks with
`node --test scripts/fleet/ratchet-inbox-relay.test.mjs`.
