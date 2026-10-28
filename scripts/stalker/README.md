# Stalker completion and recovery

A processing marker is not a delivery receipt. Default completion keeps transcript, gems and grounded `digest.md`, requires the current digest hash's durable BrainLayer chunk ID, and verifies archive custody. The v5 `digest-only` receipt remains `digest-ready` until storage is confirmed; stage 8 reports missing acknowledgment. Morning and post-stream entrypoints ingest idempotently before final verification.

Set `STALKER_DASHBOARD_ENABLED=1` to also generate frames, clips, card media and HTML. This opt-in uses v4 receipts and additionally verifies the live HTML hash, hub manifest and card media. Both modes retain text and archive media safely; failures keep `.stalker-failure.json` and leave final delivery open.

## Install configuration

The canonical checkout needs the merged completion scripts and Drive archive configuration. Hub configuration is required only for dashboard opt-in, in `docs.local/stalker-golem/delivery-config.json`:

```json
{"hubOrigin":"https://dashboard.example"}
```

Replace the example with your hub’s HTTPS origin.

`TAILNET_HUB_HOST` or `STALKER_DASHBOARD_BASE` may override that local file. The publisher writes into `golems/docs.local/dashboards/stalker/`; the sibling Orchestrator checkout supplies `scripts/sync-tailnet-dashboards.mjs`. Never write the dashboard directly into the hub's served output tree.

The runner requires Node, Python 3 for its kernel-owned run lock, and authenticated Codex. Its generation deadline remains bounded; a timeout is a failed stage, never an empty successful digest. Diagnostic output lives in the run's `.digest-work/` directory.

### Drive archive authentication

Stage 9 uses the Drive API through the sibling Orchestrator checkout's
`vendor/google-drive-mcp/oauth-token-guard.mjs`. It uses the guard's default token
path or `GOOGLE_DRIVE_MCP_TOKEN_PATH`; a signed-in Drive desktop app does not
supply that token. The guard's `--status` command reports token presence and
expiry without printing credentials. A missing or revoked token requires
recovery through that MCP's authentication flow before resuming completion.

Failures distinguish `Drive auth failed`, `Drive request timed out` and
`Drive network error`. Uploads stop immediately on auth failure; transient
upload failures keep bounded backoff and resume from the server's Range.

## Resume an existing recording

Run the canonical post-stream handler with its existing video and chat paths:

```bash
scripts/stalker/post-stream.sh \
  docs.local/stalker-golem/examplechannel-YYYY-MM-DD-HHMMSS \
  docs.local/stalker-golem/examplechannel-YYYY-MM-DD-HHMMSS/video.mp4 \
  docs.local/stalker-golem/examplechannel-YYYY-MM-DD-HHMMSS/chat.log examplechannel
```

Existing processing/scoring markers preserve earlier work. Delivery always rechecks the receipt and live hub. A publication retry reuses only a matching, versioned digest cache. Transcript or gems changes invalidate its input hash. Do not remove scoring markers or use `STALKER_FORCE_RESCORE` merely to repair delivery.

Check a run against the live publication and local custody record:

```bash
node scripts/stalker/stalker-run-contract.mjs path/to/run
STALKER_MONITOR_ONCE=1 STALKER_RUN_DIR=path/to/run scripts/stalker/stream-overnight-monitor.sh
```

The optional morning command enumerates each eligible run and invokes the same completion contract. Its date summary cannot replace per-run validation, and skip-sync/skip-live-verify cannot certify completion. `--skip-notify` is retired and rejected. Legacy v3 `notified`/`complete` receipts have an explicit migration path: preserve artifact, publication and retention evidence, revalidate live and custody checks, and atomically write v4 only after success. Partial retention resumes from existing custody evidence; a live or custody failure preserves the original receipt. A processing marker or old message ID alone cannot certify completion.

The September 8 regression test is `September 8 ratchet: processing markers and gems cannot make a run COMPLETE` in `scripts/tests/stalker-run-contract.test.mjs`. The focused CI workflow runs this contract alongside each integrated delivery slice.

## Source-only admission API (P2a)

`python3 scripts/stalker/stalker-admission.py admit --db PATH --request JSONFILE`,
`finish --db PATH --claim TOKEN --outcome complete|failed`, and `inspect --db PATH --job-key KEY`
provide a stdlib SQLite ledger; watcher, processing and delivery entrypoints remain unwired.
Requests use `schemaVersion:1`, `kind:capture|ingest`, `jobKey`, canonical existing `spool`,
integer `expectedBytes`, `temporaryBytes`, `derivedBytes`, and optional `reserveBytes` (20 GiB).
Capture requires `platform`, `channel`, `broadcastId`; ingest requires lowercase `sourceSha256`, `configSha256`.
Only new admission authorizes work. Replay/completed work is refused; abandoned active claims require recovery.
`finish` trusts its caller to stop all children first. Reservations include the full budget on the spool device.
Capture coverage stays `unknown` (`capture_not_observed`); unrelated disk writers remain outside the guarantee.
JSON v1 goes to stdout on success, stderr on failure; exits: 0 success, 75 refusal, 64 invalid, 73 storage.
Importable `admit`, `finish`, `inspect` return `(exit_code, receipt)`; tests inject observations only via `admit`.
No raw source bytes are changed. P2b runtime ownership/recovery and P2c interval repair remain separate gates.

## Source-only runtime context (P2b1, unwired)

`python3 scripts/stalker/stalker-runtime-context.py prepare-capture --platform twitch|youtube --channel CHANNEL --metadata JSONFILE`
projects supplied single-video live metadata into a closed identity. Success returns
`contextVersion:1`, `authorized:false`, `reason:CONTEXT_ONLY`, `canonicalDb`, `identity`,
and `coverageStatus:unknown`. Exit 0 prepares context only; it never permits recording.
Invalid arguments/JSON/identity return sanitized JSON stderr and exit 64; metadata IO
or account lookup failures return exit 73. Input metadata and signed URLs are never echoed.

Importable `canonical_db()` returns the current UID account home's canonical absolute
path plus `.local/state/golems/stalker/admission.sqlite3`, ignoring cwd, HOME, XDG,
spool, checkout/release roots and caller DB overrides. It creates/opens no state.
Safe account-owned state ancestors/sidecars must be validated before future mutation;
there is no storage migration or fallback database in this slice.

`capture_identity(platform, channel, metadata)` accepts TwitchStream/Youtube current-live
metadata with matching normalized alphanumeric/underscore channels and strict string IDs.
Twitch channel-name fallback (including numeric collisions) is refused. YouTube uses
the pinned 11-character video watch URL. Caller metadata is unauthenticated; Twitch's
mutable recorder URL still requires extractor-to-recorder binding before media writes.
No admission, budgets, capture, subprocess, network, finish or recovery occurs here.
Finite enforced allocation/overshoot, writer lifetime/safe finish, partial retry policy,
ingest source/config seals/output exclusion, provenance/PTS/interval repair, installed
wrappers and native capture/digest/delivery remain open. Source fixtures prove none of these.
