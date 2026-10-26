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
