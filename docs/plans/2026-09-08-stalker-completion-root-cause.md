# Stalker completion incident — 2026-09-08

Status: root cause established; implementation and installed proof pending.

## Observed failure

Theo's `theo-2026-09-08-030512` recording had nonempty transcript, gems,
signals, clips and frames, plus `.stage-process.done`, `.stage-scoring.done`
and `.stage-complete-notify.done`. It had no human digest or dashboard.
The completion marker was written at 08:45:50 Asia/Jerusalem.

## Causes at baseline b631f406

1. `scripts/process-stream.sh:1516-1540` defines completion as processing
   quality plus an attempted notification. The body at lines 1536-1537 contains a local
   `gems.md` path and volume spikes. No digest or publication is required.
   The send failure is ignored (`|| true`) and the marker is still written.
2. `scripts/post-stream.sh:245-249` runs synchronous archive/compression
   before its legacy Telegram digest at lines 281-282. The real run log
   reached archive compression at 08:45:50 after logging PROCESSING COMPLETE.
   Archive is a delivery dependency even though a human digest needs no upload.
3. The separate `stalker-morning-digest.mjs` generator is not called by either
   processing script. Its launchd template exists, but the installed
   `com.golems.stalker-morning-digest` plist and loaded service were absent
   during the incident inspection. A template in git is not an installed job.
4. Even if installed, `launchd/com.golems.stalker-morning-digest.plist:20-28`
   schedules 07:30; this run finished scoring at 08:27 and processing at 08:45.
   The one-shot generator cannot deliver a run that has not finished yet.
5. `scripts/stalker-morning-digest.mjs:223,259-272` runs hub sync first, then
   writes HTML directly into the generated serve tree and adds broad run-directory
   media symlinks. It does not publish through a durable admitted source or check
   the manifest. It is outside the canonical `dashboards/` inventory and cannot
   be reconstructed from admitted sources. Current sync removes `dashboards/`,
   not this root-level `stalker/` directory; direct pruning of this exact path
   is not established. The historical pruned route was under `dashboards/`.
6. `scripts/stream-overnight-monitor.sh:93-144` independently calls the pipeline
   done from processing artifacts. It also needs the delivery contract.

## Historical evidence checked

The August 20 digest incident fixed marker-less failures and bounded notifications,
but ended with scheduler deployment unverified. The August 27 dashboard incident
showed a route returning HTTP 200 and later being pruned by hub reconciliation.
The current source still contains both missing integration and transient publishing.

## Required invariant and slices

A run is COMPLETE only after nonempty `gems.md`, a human digest containing
timestamped topics, 5–10 highlights and claims worth checking, and dashboard HTML
exist; the dashboard is admitted to the hub manifest and returns HTTP 200 with
the expected content; and a successful completion notification contains that URL.
The receipt must bind those artifacts to this run. Earlier processing markers and
dry-run/bypassed checks cannot satisfy completion. Any failure logs FAILED with
its stage, records durable failure and attempts a failure notification.

1. Land the completion validator and regression fixture reproducing this run's
   exact artifact/marker shape. Prove old completion evidence is rejected.
2. Integrate digest, durable publication and notification before optional archive;
   route every completion producer through the validator. Keep retries possible.
3. Replay the recorded run without downloading or rescoring it, verify the real
   published content after another hub sync, and reload the installed guard.

The root-cause document is evidence of diagnosis only. It does not claim the
pipeline fixed, the dashboard delivered, or the installed scheduler verified.
