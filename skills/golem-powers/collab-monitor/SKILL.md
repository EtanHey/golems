---
name: collab-monitor
description: "Use native Monitor for addressed collab mail, report DONE markers and installed-version watches; use the packaged detached fallback on Codex seats. NOT for file-integrity auditing."
version: 1.3.1
type: encoded-preference
last-eval-date: 2026-10-08
compliance-score: "6/6 episode regressions; 18/19 existing routing checks (pre-existing large-plan teaching failure); no agent-behavior or native Monitor runtime proof"
---

# Collab Monitor

Use the native **Monitor** tool when the harness exposes it. Arm before dispatch,
keep the returned watch identifier in the lane record, and stop it when its lane
closes. Codex seats use the fallback below. A detached producer alone does not
wake an agent.

## Native Monitor first

Call `Monitor({command, description, timeout_ms: 1800000})`: a command, a short
description naming the lane, and a 30-minute timeout. This Claude Code harness
caps the tool at 1800000 ms; other harness versions may differ, so check their
schema. Give it events that each require action; use one completion watch for
a batch of tests or CI jobs.

### Collab tail with a lead filter

Use the foreground routing filter as the native tool's command. Monitor owns the
process and wakeups; the filter owns watermarks, hash dedup and author matching.
This avoids spawning a detached producer before every native watch.

```text
Monitor({
  command: 'bash "$HOME/.claude/skills/collab-monitor/scripts/collab-monitor.sh" run --alias @<seat-id> @<lead-listen-name> /absolute/path/collab.md',
  description: '<lane> addressed collab mail',
  timeout_ms: 1800000,
})
```

Replace the listen name, seat alias and file with the actual lane values. Use a
private, explicit state root via `MONITOR_STATE_DIR` when isolating a test watch.
Resolve the script from the skill location supplied by your harness; the example
uses this MacBook's installed `~/.claude/skills/collab-monitor` symlink. Verify
the resolved script exists before arming; use its absolute path on other hosts.
Never point a test watch at a real lane's state root.

The bounded lead filter accepts word-bounded `@<name>` mentions, headers addressed
`### author → name` (also `->`), and that lead's own `<name>-w<N>` / `<name>-r<N>`
DONE/BLOCKED lines. It excludes self-authored blocks, signature-only tags,
near-miss names and unrelated headings. Fenced and indented code cannot route
mail; an unclosed fence reports an incomplete poll and is retried. Add `--alias`
for each actual delivery name, not a broad prefix.

The first poll seeds existing history silently. Re-arming with the same state
root preserves dedup. New mail should produce `NEW-FOR-@<name>`; readiness alone
is not proof that the consumer received a message. Append collab posts with
`cat >>` or an append-only writer.

Repeated identical headings in one append-only file are separate occurrences.
The first retains its content hash; later ones carry `episode=2`, `episode=3`,
etc. Read that routed occurrence outside code in the alert's file for its report body
and pointer. Extending a body does not create another heading episode. Restart
preserves dedup; existing heading-only state silently seeds pre-watermark repeated
headings on its next successful growth poll. Identical copies at the same
occurrence in different watched files still share a dedup key. Use a unique final
completion heading per report episode so older installed monitors also catch it.
This repair does not attach a parent consumer or replay a missed report.

### Report-file DONE markers

Set the report path and the exact marker in this command, then pass it as
Monitor's `command` with `timeout_ms: 1800000`. Check the **exact final line**,
not a DONE word in the report body. This watch completes once; read the report
and verify its requested artifact after it fires.

```bash report-done
REPORT='/absolute/private/report.md'
DONE_MARKER='DONE_LANE'
deadline=$(( $(date +%s) + 1800 ))
while true; do
  if [ -r "$REPORT" ] && [ "$(tail -n 1 "$REPORT")" = "$DONE_MARKER" ]; then
    printf 'REPORT_DONE %s\n' "$REPORT"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    printf 'REARM_REQUIRED report watch\n'
    exit 0
  fi
  sleep 1 # Cheap local file-stat poll cadence; not an urgency signal.
done
```

A marker is a handoff signal, not proof of merge, publication or installation.
If the report is missing or malformed, the watch stays open until its deadline.

### Installed-version watches

Query the installed command, not the checkout, a merge receipt or a release tag.
Set the exact expected `--version` output and pass this body to native Monitor.
The command re-reads the installed binary on every tick, including replacements
at the same path.

```bash installed-version
TOOL='/absolute/path/installed-command'
EXPECTED_VERSION='expected exact version output'
deadline=$(( $(date +%s) + 1800 ))
while true; do
  if current="$("$TOOL" --version 2>/dev/null)" && [ "$current" = "$EXPECTED_VERSION" ]; then
    printf 'VERSION_MATCH %s\n' "$current"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    printf 'REARM_REQUIRED installed-version watch\n'
    exit 0
  fi
  sleep 1 # Cheap local file-stat poll cadence; not an urgency signal.
done
```

After a version match, run the required **real-client smoke**. A version string
alone does not prove the installed service serves requests successfully.

### Re-arm at 30 minutes

The 30-minute re-arm is the tool's **hard expiry**, not an optional reminder.
On expiry and **after every compaction**, re-check which lanes remain open and
re-arm their watches using current paths, identifiers and expected versions. Report/version examples emit `REARM_REQUIRED` after their 30-minute
budget. For a collab stream, cancel the prior native watch by its returned
identifier before replacing it; keep the same routing state to avoid history
replay. In this Claude Code harness, use **TaskStop** with the returned task id
to cancel early; check the current schema on other harness versions. Do not
leave duplicate streams attached.

When a watch ends unexpectedly, repair it and re-arm before dispatch resumes.
When its task finishes, stop it. Workers do not monitor their lead's reviewer.
Review routing: `/agent-routing` § Routing rules (SSOT). Follow an engine-issued
mailbox contract when one exists.

## Codex fallback

Codex seats without native Monitor use the packaged detached producer. Record
its listen name and PID, verify readiness, and attach its consumer to the
orchestrator's monitored command session:

```bash
CM="$HOME/.claude/skills/collab-monitor/scripts/collab-monitor.sh"
# Or set CM to the absolute script path from your harness's skill catalog.
test -f "$CM" || { printf 'Missing collab-monitor script: %s\n' "$CM" >&2; exit 1; }
bash "$CM" start --alias @<seat-id> @<listen-name> /absolute/path/collab.md
bash "$CM" status @<listen-name>
bash "$CM" follow @<listen-name>
```

`start` persists independently of the invoking shell. `follow` replays the
current session log then streams new alerts, and exits when that named watch
stops. It is the attached consumer, not proof of a native Monitor tool on Codex.
For a caller-owned foreground process, use `run`; for a scheduled single poll,
use `run --once`. Both use the same bounded routing filter.

After handoff or lane closure:

```bash
bash "$CM" stop @<listen-name>
```

Stop by listen name, never by a process-name pattern. The implementation checks
PID and per-start identity before signaling. On `STATE_CONFLICT`, inspect the
preserved records; do not delete state or signal an unverified process.

Defaults: state `~/.local/state/collab-monitor/<listen-name>/`, positive
`POLL_SECONDS`, readiness budget 30 seconds. `START_TIMEOUT_SECONDS` can extend
readiness to at most 86400 seconds; malformed intervals and names `.` / `..`
are rejected. `--include-self` is for explicit audits only and labels those
records `SELF-POST` rather than inbound mail. Never share test state with a lane.

## Limits and supervision

The filter detects byte-size shrink, retries transient missing/unreadable files,
and reports incomplete polls. It does not detect same-size rewrites, messages
outside the routing grammar, process death without a supervisor, or completion
visible only in a worker registry. A crash between alert emission and persistence
can duplicate the final alert: delivery is at-least-once.

You MUST NOT poll `read_screen` in a loop for a worker outcome. For headless Codex
workers use `codex-workflows`' `watch`: observe process completion, then read its
finished output once. A monitor observes an artifact, not whether a reviewer was
actually routed. Keep handoff ownership explicit in the lane's `closure` record.

## Recurring payloads

Use live queries on every tick; never copy a stale PR state into the payload.
Frame the tick with a timestamp, cycle and last verified action. Counters reset
only on a verified side effect. Finish with dispatch, verify-and-decrement or
escalate-park. Scheduler-specific fallback guidance is in
[references/cron-payloads.md](references/cron-payloads.md); it is not a prerequisite
for native Monitor.

## Evaluation

```bash
python3 skills/golem-powers/collab-monitor/evals/monitor-howto.py
python3 skills/golem-powers/collab-monitor/evals/episode-dedup.py
bash skills/golem-powers/collab-monitor/evals/run-evals.sh candidate
bash skills/golem-powers/collab-monitor/evals/live-two-file-smoke.sh
```

The how-to checks exercise synthetic report/version command transitions and
teaching contracts. The routing suite exercises the packaged filter and detached
fallback. Neither proves native Monitor execution on a harness where it is
unavailable. Agent-behavior scenarios are recorded separately in `evals.json`.
