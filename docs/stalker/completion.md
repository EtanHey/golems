# Stalker completion and recovery

A processing marker is not a delivery receipt. A Stalker run is complete only after its human digest, admitted dashboard, media verification and archive custody pass `stalker-run-contract.mjs`.

Delivery runs before archive compression. It writes `digest.md`, `dashboard.html` and `.stalker-completion.json` inside the recording directory. The v4 local receipt uses `published` and `complete` statuses. Stage 6 generates a grounded digest, stage 7 checks the live HTML hash, hub manifest and every card's clip/poster hashes, and stage 9 verifies retention/custody. Stage 8 was retired on 2026-10-01. A durable `published` checkpoint precedes retention; only all completed checks permit `complete`. Failures keep `.stalker-failure.json` and leave completion open.

## Install configuration

The canonical checkout needs the merged completion scripts. Configure the hub once in `docs.local/stalker-golem/delivery-config.json`:

```json
{"hubOrigin":"https://dashboard.example"}
```

Replace the example with your hub’s HTTPS origin.

`TAILNET_HUB_HOST` or `STALKER_DASHBOARD_BASE` may override that local file. The publisher writes into `golems/docs.local/dashboards/stalker/`; the sibling Orchestrator checkout supplies `scripts/sync-tailnet-dashboards.mjs`. Never write the dashboard directly into the hub's served output tree.

The runner requires Node, Python 3 for its kernel-owned run lock, and authenticated Codex. Its generation deadline remains bounded; a timeout is a failed stage, never an empty successful digest. Diagnostic output lives in the run's `.digest-work/` directory.

## Resume an existing recording

Run the canonical post-stream handler with its existing video and chat paths. To deliver without repeating the optional archive operation:

```bash
STREAM_AUTO_ARCHIVE=0 scripts/stalker/post-stream.sh \
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
