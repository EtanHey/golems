---
name: fleet-wrap
description: "Quiet sprint close: stop monitors, send final dashboard/message. Triggers: fleet wrap, stand down."
---

# /fleet-wrap — the quiet-down protocol

> Fleet law: canon #7 owns guard/DONE/harvest-close. This skill keeps the operational wrap procedure: stop monitors, publish one final artifact/message, then stand down.

**When the fleet wraps: ZERO polling crons, ONE final dashboard + ONE message, then SILENT.**

If the planned overnight mechanism breaks, choose one of two paths only: delegate real approved work to a live owner, or stand down silent. A polling loop with zero workers is the inverted fleet-wrap failure.

## When this fires

- All workers are done/idle AND their claims are verified — no queued approved work remains.
- The overnight/sprint queue is exhausted.
- Etan said "wrap the fleet", "stand down", "we're done", or approved the final state.

**Disambiguation vs `/session-handoff`:** "wrap up" aimed at YOUR session (context
high, session ending, successor needed) routes to `/session-handoff` — that skill
owns single-session continuation. THIS skill fires on FLEET-wide close: all
workers done, nothing queued, the channel goes quiet. When both apply, run
`/session-handoff` FIRST — then this protocol governs the outgoing agent's exit.

## Retire protocol (outgoing agent — pairs with `/session-handoff`)

Succession is **routine** (gen-12 evening: orc → gen-13 path, vl LEAD v1→v2, bl LEAD outgoing→successor — three successions one day). Before you compact or go silent:

1. **Hand off completely** — live-watch transfer list written (see `/session-handoff`); successor brief posted; grill answered (monitors still running during transfer).
2. **Stop monitors** — kill every cron/monitor you own so compaction doesn't fire on stale loops (`71a8e3f5 [5418]`).
3. **Final dashboard** (if fleet-wide wrap via this skill).
4. **Kill your own pane** — do not linger as a zombie orc writing duplicate handoffs.

Order: handoff → stop monitors → final dashboard (if fleet-wide wrap) → close pane.

## The protocol (in order)

1. **VERIFY done.** Per worker: state check + independent claim verification
   (`/never-fabricate` R8). A fleet is not wrapped because it looks quiet.
2. **KILL ALL POLLING.** `CronList` → `CronDelete` every monitor/heartbeat/status
   cron you own; `TaskStop` background monitors; report the stopped IDs in the
   wrap-up (orc REF9). Zero exceptions — a "harmless" 5-minute status cron is
   exactly how the WhatsApp-all-night failure happened.
3. **ONE final dashboard** (`/html-dashboard`, cloned template — never from
   scratch): sprint state, merged PRs, open loops, blockers, money/tokens spent.
4. **ONE final message** (WhatsApp / the agreed channel): dashboard link +
   a 2-3 line summary. ONE message. Not one per event.
5. **brain_store the wrap** — sprint summary, stopped cron/monitor IDs, open
   loops. Tags: `milestone`, `<project>`.
6. **SILENT.** No further messages, no re-armed loops, no "still quiet"
   heartbeats — until Etan speaks or new approved work arrives.

## What silence does NOT mean

- **Blockers found during wrap** go ON the dashboard and IN the one message —
  not as a follow-up stream.
- **A real incident** (data loss in progress, security) justifies ONE alert.
  Everything else waits for the next session.
- **Silence ≠ abandonment.** Open loops are written down (dashboard + collab +
  brain_store) so the next session picks them up — the channel goes quiet, the
  state does not evaporate.

## Anti-patterns

| Don't | Evidence |
|---|---|
| Relaying/listing the user's own messages back to them overnight | The dawn quote above — the incident this skill exists for |
| Planned overnight mechanism broke, so orc kept polling with zero workers | Inverted fleet-wrap: delegate real work or stand down silent |
| Leaving the fleet-monitor cron running after wrap | "Why didn't you stop?" — polling crons outlive their sprint |
| "One more status update" after the final message | One message means one |
| Keeping idle worker panes alive "just in case" | Wasted-money panes, gen-7 `f3231646:[2655]` |
| Wrapping without verifying worker claims | A "wrapped" fleet with an unverified worker is an unwrapped fleet |

## Integration

| Skill | Relationship |
|---|---|
| `/fleet-wrap-gate` | The MECHANICAL check for step 2: at this terminal state, asserts cron-count==0 (no health-watch/`/loop`/sleep-poll cron left armed). Run `bun skills/golem-powers/fleet-wrap-gate/scripts/fleet-wrap-gate-cli.mjs <transcript\|->` before going silent; exit 3 = a cron is still armed |
| `/orc` | Composition-map row "Fleet wraps / sprint close" routes here; REF9 (stop monitoring when done) is step 2 |
| `/session-handoff` | Successor spawn happens BEFORE wrap; the outgoing agent then wraps silently |
| `/weave` | The weave fires at convergence — a weave run ends with its own fleet-wrap |
| `/html-dashboard` | The one final artifact (step 3) |
| `/never-fabricate` | R8 claim verification gates step 1 |
