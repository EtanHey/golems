# Stalker Scoring Restart Failure Implementation Plan

> **For Codex:** Execute with TDD and stop at an unmerged PR.

**Goal:** Prevent false live-guard restarts from killing detached scoring, preserve genuine active-recording stall recovery, and make any remaining scoring interruption durable and visible.

**Architecture:** Separate timestamp-based run identity from mtime-based video growth. Add a durable scoring start/done ledger reconciled by later pipeline and digest entries, plus a fast TERM/EXIT trap around existing scorer cleanup. Keep post-processing in the current launchd coalition for this patch and file service isolation separately.

**Tech Stack:** Bash, Bats, launchd command stubs, existing Stalker helper library.

---

### Task 1: Lock selector and watchdog behavior with failing tests

**Files:**
- Modify: `scripts/tests/test-stream-helpers.bats`

Add exact-cascade selector coverage where an older directory has the newest mtime. Add a one-cycle live-guard integration test with a stalled video in the newest run and assert the restart reason and exact launchd service target. Run both tests and record the expected failures.

### Task 2: Implement timestamp-only selection without weakening stall detection

**Files:**
- Modify: `scripts/lib/stream-helpers.sh`
- Modify: `scripts/stalker-live-guard.sh`

Add a strict stamped-directory selector and wire the live guard to it. Add only the test seams needed for a bounded one-cycle integration test. Preserve size and video-mtime growth logic.

### Task 3: Lock durable scoring interruption behavior with a failing test

**Files:**
- Modify: `scripts/tests/test-process-stream-agy-cli.bats`

Extend the existing mid-flight TERM test to require `.stage-scoring.failed`, an absent incomplete `gems.md`, and a captured Telegram payload naming the run and retry path. Add a SIGKILL test that proves reconciliation reports the failure without cooperation from the dead process, plus post-stream and digest entrypoint integration coverage. Run them before implementation and record the expected failures.

### Task 4: Implement scoring lifecycle failure handling

**Files:**
- Modify: `scripts/process-stream.sh`

Write the start ledger before scoring and the done marker only after a complete outcome. Reconcile dead or identity-mismatched starts on later post-stream and digest entries. Replace the cleanup-only EXIT trap with signal-aware failure handling for fast trappable-signal reporting, reuse `stalker_record_stage_failure`, and retain scorer tree cleanup without introducing stale direct-PID ledgers.

### Task 5: Verify and recover

Run focused tests, syntax checks, shellcheck if available, the full Bats suite twice, and exact real-cascade selection checks. Re-score `theo-2026-08-20-013717` and `theo-2026-08-20-032309` through `STALKER_FORCE_RESCORE=1`; verify the completion footer and report gem counts.

### Task 6: Review and handoff

Request Claude pair review, resolve findings, commit with agent identity, push, open a PR against `master`, and run the required review rounds. Do not merge. File option C as a separate structural follow-up and append the required collab and cmux reports.
