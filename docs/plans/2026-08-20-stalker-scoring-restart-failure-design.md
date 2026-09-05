# Stalker Scoring Restart Failure Design

## Problem

The live guard chooses a run directory by directory mtime. Detached post-processing mutates an older run directory, making it appear newest. If that older run's video is stale while a newer recording is active, the guard restarts the watcher launchd job and kills the in-flight scoring process in the same launchd coalition.

The mtime-based video-growth watchdog itself is intentional. PR #419 added it after a recorder remained alive but stopped writing for 2.5 hours. This change must fix run selection without weakening active recording stall detection.

## Approved design: option A

1. Select the active run only from the validated `<channel>-YYYY-MM-DD-HHMMSS` basename. Lexical order equals chronological order. Directory mtime is never consulted for selection.
2. Keep the existing selected-video size/mtime growth tracking and launchd restart behavior. A genuine stall in the newest active run still diagnoses that exact video and kickstarts only `com.golems.stream-watcher`.
3. Before scoring starts, persist `.stage-scoring.started` with the pipeline PID, wall-clock timestamp, and process start identity. Successful scoring writes `.stage-scoring.done`. Every later post-stream entry and the digest entrypoint reconcile a started-without-done run: if the recorded process identity is gone, remove incomplete `gems.md`, write `.stage-scoring.failed`, and alert. This is the SIGKILL, power-loss, and OOM guarantee and is independent of the selector.
4. While scoring is active, TERM, INT, HUP, or an unexpected EXIT performs the same failure reporting immediately and cleans up scorer workers. This trap is a faster optimisation for trappable exits; it cannot cover SIGKILL.
5. Recover the two casualty runs using the existing `STALKER_FORCE_RESCORE=1` path and require complete, real `gems.md` artifacts.

## Structural follow-up

Option C—moving post-processing into a separate launchd service—is not part of this patch. It remains the durable isolation improvement because a legitimate future watcher kickstart can still terminate a same-coalition processor. File it with the casualty and coalition evidence instead of expanding this narrow recovery patch.

## Acceptance evidence

- Exact rapid cascades `032306/032307/032309` and `052008/052009/052010` select the last stamp even after an older directory is mutated.
- A newest-run mid-recording hang still triggers diagnostics and the exact watcher kickstart.
- TERM during scoring immediately produces a retryable marker and Telegram payload naming the run, even with the selector change absent.
- SIGKILL leaves the start ledger intact; the next post-stream or digest entry reconciles it into the same retryable marker and alert.
- Both real casualty directories produce complete `gems.md` files with gem counts.
