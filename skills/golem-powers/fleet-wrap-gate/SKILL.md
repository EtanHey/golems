---
name: fleet-wrap-gate
description: "Kill-gate: at fleet-wrap/stand-down assert cron-count==0. Triggers: fleet wrap, stand down, sprint close, going silent."
disable-model-invocation: true
---

# Skill: Fleet-Wrap Terminal-State Gate (gen-18 Track 1 #6)

> When the fleet wraps: ZERO polling crons. A "harmless" 5-minute health-watch left running all night IS the failure.
> Etan at dawn (verbatim, red-team verified): *"Why were you just listing my messages in WhatsApp the whole night? Why didn't you stop?"* — 2× imp-10.

## Scope

cron-count==0 means no health-watch, `/loop`, or sleep-poll cron left armed.

## What It Is

A deterministic detector over an agent transcript plus durable cron/loop state: once a
turn reaches a **terminal / stand-down state** (fleet wrap, sprint close, "back to
silent", "only an Etan decision pending", "all work merged", `DONE`), **cron-count
MUST == 0**. If a durable registry/state file still contains a live cron or `/loop`,
the hook adds an advisory (a `systemMessage`, never a Stop block since GO-5 E2) with a typed cleanup reason: **`FLEETWRAP_CRON_ALIVE`** or
**`FLEETWRAP_LOOP_ALIVE`**. This is the MECHANICAL gate that `/fleet-wrap` describes
in prose — "manual gates drift, automated gates don't." The pinned RED/GREEN transcript
and state fixtures ARE the replayable gate (R-003/R-014 pattern).

## The Rule

Two independent violation routes — a **banned poller** is never excused; a **generic cron**
is excused only by the monitor-law:

| At a terminal state, this... | Verdict |
|---|---|
| **banned poller** armed: `/loop` timer, `while true`/`for…seq`/`nohup … sleep` poll loop, or a durable live loop state entry | `FLEETWRAP_LOOP_ALIVE` — advise `TaskStop <id>` |
| **generic / periodic cron** live in durable state, or a same-turn `CronCreate` / `schedule_task` not cleared and not the inbound monitor | `FLEETWRAP_CRON_ALIVE` — advise `delete cron <id>` |
| **crons cleared** — durable cron/loop state has zero live periodic entries | PASS |
| **ONE inbound standby monitor** (even via a `CronCreate` framed as inbound), no health-watch/poll/loop | PASS |
| not a terminal turn (mid-sprint, still driving, more work queued) | PASS (N/A) |
| discussion about the fleet-wrap rule/gate, or a worker-seat scoped `DONE` that explicitly is not fleet wrap | PASS (N/A) |
| **lane DONE report** (at any state, terminal or not): a `gh pr merge` the turn executed (parsed shell), a "PR #N merged" / "handed PR #N to the lead" claim, a written `DONE_<ID>` marker (Write/Edit content, echo/printf redirect, or a here-document into a file), or a `DONE` line with a PR URL, and **no `CLEANUP RECEIPT`** (heading + `worktree:` + `branch:` lines) in the turn's output, a report it wrote, or a report file it cites | `FLEETWRAP_CLEANUP_RECEIPT_MISSING` — advise appending the receipt (`/pr-loop` `references/merge-and-verification.md` § Cleanup Receipt). Advisory in the Stop hook; the CLI prints it but keeps exit 0 unless a cron/loop code also fired |
| same DONE report carrying its receipt; a mid-sprint push with no DONE; discussion about receipts; negated/conditional merge talk ("not merged yet", "once #N is merged"); a marker or merge claim inside a fenced block or `>` blockquote; a `gh pr merge` that is only printed (`echo gh pr merge …`), quoted, or commented | PASS (N/A) |

Wrap-state doctrine line: **inbound collab monitor STAYS, everything periodic DIES, the
decision is left in front of Etan, then silence.**

**Terminal-state markers:** "fleet wrap", "stand down", "back to silent", "going silent",
"sprint close(d)", "all work merged", "only an Etan decision pending", "nothing queued",
plus inbound/standby posture ("standing by for Etan", "awaiting an Etan decision").
A bare *clearing* phrase ("cleared all crons") on its own is NOT a stand-down — it is blanked
before the terminal test so a mid-sprint "cleared old crons … more work queued" stays N/A.

**The ONE allowed exception (monitor-law):** a single persistent **INBOUND** collab/standby
monitor (waiting for Etan / an inbound reply) is allowed — including a real `CronCreate` the
narrative frames as that inbound monitor. What's banned is health-watch / status-poll crons,
`/loop` poll timers, and fleet-monitor loops. Calling a health-watch an "inbound monitor" does
NOT excuse it; a same-turn `CronDelete` of some *other* cron does NOT excuse a freshly-armed
poller; and a prose "no crons" disclaimer does NOT clear a cron actually invoked this turn
(all pinned as evasion REDs).

"Same turn" = the events since the last human message. Terminal-state markers come from
the turn's text; live cron/loop truth comes from durable state (`state`, `state_path`,
`cron_state_path`, `loop_state_path`, or bounded Claude task-state discovery in the Stop
hook). A prose claim such as "all crons deleted" or "cron-count=0" is NEVER trusted over
durable live state. DETERMINISTIC: same transcript/state in → same verdict out.

**Cleanup receipt (cleanliness standard Mechanism 1, 2026-09-28).** Cleanup is part of done:
every lane DONE ends with a `CLEANUP RECEIPT` (worktree / branch / files outside src+tests /
docs.local this lane created). `FLEETWRAP_CLEANUP_RECEIPT_MISSING` is an advisory like the cron
codes, never a Stop block (GO-5 E2), and it is independent of the terminal-state test: a worker's
DONE is not a fleet wrap, but it still owes a receipt. The receipt may live in a report file the
turn cites; the Stop hook and CLI read up to 4 eligible local `.md`/`.txt` paths, 256 KiB each
(`lib/report-reader.mjs`), and a fixture supplies them as a `reports` map. Paths named in the
narrative are read first, then shell write targets, then files written by tool; ineligible paths
are dropped before the cap.

## How /fleet-wrap Consumes It

`/fleet-wrap` step 2 already states **"KILL ALL POLLING — `CronList` → `CronDelete` every
monitor/heartbeat/status cron, zero exceptions."** This gate makes it mechanical: before
the outgoing agent goes silent, run the gate on the wrap turn —
`bun skills/golem-powers/fleet-wrap-gate/scripts/fleet-wrap-gate-cli.mjs <transcript|->`
(exit 3 = a cron/loop FLAG; a receipt-only `FLEETWRAP_CLEANUP_RECEIPT_MISSING` is printed and exits 0). A FLAG means a cron or loop is still armed at stand-down: run the exact
cleanup action in the reason (`delete cron <id>` / `TaskStop <id>`), then go silent.

Hook wiring uses `scripts/fleet-wrap-gate-hook.mjs` as a Claude Code Stop hook. The hook
is local-only: no network, no BrainLayer, no subprocesses, bounded stdin/path/task-state
reads, and fail-open on malformed input or internal errors. It emits the Claude Code
stdout schema:

- allow: `{}`
- advisory: `{"systemMessage":"FLEET-WRAP-GATE advisory: ..."}` (a flag; never a block)

`install-snippet.json` pins the absolute Node path:
`$HOME/.nvm/versions/node/v22.22.0/bin/node`.

## Relationship to Track 6 D4 (frustration-capture, PR #523)

This gate **complements, does not duplicate** the frustration-capture Stage-A gate. That
hook (`frustration-capture-prompt.py` — `_FLEET_TICK_OPENER`, orchestrator-monitor
`_HARNESS_MARKERS`) filters INBOUND `scheduled_task_fire`/cron PROMPTS **by sender-identity**
so a cron tick is not misread as an Etan correction — i.e. it governs *reading* cron
prompts. THIS gate governs whether a cron is still **ARMED** at fleet-wrap. Two different
edges of the same cron-discipline surface; neither subsumes the other.

## Run It

```bash
bun test skills/golem-powers/fleet-wrap-gate/evals/fleet-wrap-gate.test.mjs   # replay (CI-safe)
python3 skills/golem-powers/fleet-wrap-gate/evals/run_suite.py                # hook stdout-schema suite
bun skills/golem-powers/fleet-wrap-gate/scripts/fleet-wrap-gate-cli.mjs <transcript.jsonl|->
```

Programmatic: `import { detectFleetWrap } from "./src/fleet-wrap-gate.mjs"` →
`detectFleetWrap(transcript, { state })` returns `{ verdict, terminal, violations }`.

## Stated Limits (honesty rule)

- Durable state is only as complete as the hook payload/default task-state source. If no
  state is available, the detector still catches same-turn tool/command evidence, but a
  hidden external cron cannot be proven from prose alone. Wire the Stop hook where durable
  cron/loop state is available.
- The Stop hook scans task-state files with hard bounds and fail-open behavior; it does not
  run `CronList`, call BrainLayer, or spawn subprocesses.
- Cleanup receipt: one receipt anywhere in the turn's own output (narrative or content it wrote)
  satisfies the check, even when the turn merged several PRs or the receipt text was written for
  another purpose. A receipt seen only in a tool result (another lane's report the turn read)
  does not count. The check reads a receipt's shape (heading + `worktree:` + `branch:`), not
  whether its claims are true. A report file cited only by a relative path, or written by a script the
  transcript does not show and never named in the turn, is not read; the advisory then fires,
  and the fix is to cite the report's absolute path or paste the receipt in the DONE message.
- Receipt scanning has a shared 4 million work-unit / 350 ms per-turn budget. If it is
  exhausted, only the receipt advisory fails open; an independent live cron/loop verdict
  remains. Narrative report-path extraction caps a path body at 1,024 characters and treats
  `=` as a new path delimiter; explicit tool paths and shell write targets remain eligible.
- Report-file policy (`lib/report-reader.mjs`): a cited path must be absolute or `~/`, end in
  `.md`/`.txt`, and contain no `..` segment (rejected, never normalized). A symlink is followed only
  when its realpath target passes every check: a `.md`/`.txt` name, a regular file (not a FIFO or
  device), at most 256 KiB. The target is opened once and type and size come from `fstat` on that
  descriptor. There is no trusted directory: any readable local file that passes is read. Contents
  are matched against the receipt shape only and never echoed into the advisory.
- Shell parsing is a small lexer (`lib/shell-commands.mjs`): quotes, escapes, comments, `;`/`&&`/`||`/`|`,
  redirects and here-documents. It does not look inside `$(…)`, backticks or `bash -c "…"`, and it
  unwraps `VAR=x`, `sudo`, `env`, `command`, `exec`, `nohup` and `time` only when they have no
  options (`sudo -u bob gh pr merge` is not seen as a merge). A missed merge still counts through a
  narrated "PR #N merged" or a DONE line.
- Fenced blocks and `>` blockquotes never produce a DONE signal, so a real marker placed inside a
  fence is missed. Put the `DONE_<ID>` line outside any fence.

## Provenance

RED north-star: the gen-10 dawn incident — health-watch / status cron left firing all night
after the fleet had effectively wrapped ("Why didn't you stop?"), pinned in MEMORY as 2×
imp-10 ledger rows. Evasion REDs: disguised-as-inbound-monitor, only-an-Etan-decision-pending,
back-to-silent poll loop, narrative-only health-watch, schedule_task tool variant,
standby-without-the-word-"wrap" + health-watch (inbound posture is terminal too),
cron-tool-narrated-away (prose "no crons" over a real CronCreate), delete-old +
create-new-health-watch (a clear of some OTHER cron does not excuse a fresh poller),
for/seq poll loop with a non-"i" loop variable, multiple-CronCreates-as-"one-inbound-monitor"
(one-monitor law), a health-watch hidden in the CronCreate payload, delete-old +
create-new-GENERIC-cron (a CronDelete does not clear a freshly-created cron), a narrative-only
`/loop` admission, wrap-plus-"more-work-queued" + CronCreate (a strong wrap marker + an
armed cron is evaluated, not escaped as mid-sprint), and a generic recurring job (nightly
digest / fleet driver) relabeled "one inbound monitor" (the inbound payload must match the
inbound claim). GREEN
references: crons-cleared + one-inbound-monitor, mid-sprint N/A, TaskStop-no-monitor, plain
status line, stand-down awaiting-Etan inbound-only.
