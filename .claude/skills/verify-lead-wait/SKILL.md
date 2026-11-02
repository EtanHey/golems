---
name: verify-lead-wait
description: Verify PR ownership and eventual action when changing pr-loop's waiting policy, settle/handoff rules, or scripts/pr-sentinel. Rerun LeadWait and check its mapping to the source.
---

# Verify lead waiting

Every unheld red or green PR must eventually be fixed, merged, or visibly held.
Otherwise a finished PR can remain unattended indefinitely. TLC checks event orderings
in a finite model; the sentinel regressions check real Python behavior with fake external tools.

## Run from the repository root

Install Bun, Python 3, Java 11+ and a `tlc` executable using tla2tools 1.7.4
(reports TLC2 2.19). Then run one command:

```sh
python3 .claude/skills/verify-lead-wait/verify.py
```

It runs the sentinel tests and all six configs with one worker, retaining logs under
`docs.local/verify-lead-wait/`. Exit 0 means the nonhistorical configs pass; exit 1 is
a current model finding; exit 2 is a source regression or unexpected checker result.
Missing dependencies fail, never skip. Today, WakeIgnored and SettleWithoutHandoff
must still demonstrate their historical violations. **SentinelOnly currently fails**:
a live owner ignores its wake, gets one nudge, ignores it, and never reaches orc.
See [results and reproduction](../../../docs/tla/lead-wait/README.md).

Read **every result with pstack `/statechart`**, including passes. It draws the reachable
states and explains counterexamples. Keep that skill's current commands and tooling
in its own instructions. The committed [chart](../../../docs/tla/lead-wait/statechart.md)
records the present paths. Liveness counterexamples repeat forever; a finite prefix
alone is not the bug.

## Coverage and synchronization

Source sync commit: `13903d0573c78b708e5100d86771733f447ee4ab` (master).
The source-aligned Nudge guard records that source's missing live-owner escalation.
This is a correspondence record, **not** a passing certification.

| Model surface | Source coverage |
|---|---|
| `EndTurnCheck`, `Act`, `SilentIgnore` | `skills/golem-powers/pr-loop/references/review-loop.md`, Waiting policy: "Watching is not waiting", ordered end-turn cases; `/pr-loop` SKILL.md, draft-first inner loop |
| `Handoff`, `Settle` | Same Waiting policy, "Ownership outlives the thread"; `skills/golem-powers/pr-loop/references/dispatch-and-handoffs.md`, handoff responsibilities |
| `Hold`, `Unhold` | Same Waiting policy, "Held is visible, never silent"; sentinel `classify` only approximates this (it also skips ordinary drafts) |
| `Sentinel`, `Nudge` | `scripts/pr-sentinel/pr-sentinel`: `lead` sends once per head/class, `scan` escalates orphans; `scripts/pr-sentinel/README.md`, lead check and orc sweep |
| Source probes | `scripts/tests/pr-sentinel.test.mjs`; `docs/tla/lead-wait/reproduce.py` replays the ignored-live-owner case |

Before judging a changed source, diff these covered sections against the sync commit.
Trace each changed transition, guard and fairness assumption to the source. A plain
TLC pass cannot detect a source edit by itself. Move the sync commit forward only
after checking that the model still describes that exact revision; record changes
on top of master separately until they merge. Use `/maintain-formal-verification-skill`
when bringing an old coverage record up to date.

## Interpret and repair

Replay a counterexample against the real source in its action order. Use fake GitHub
and T3 boundaries: do not send real messages for verification. A matching source
trace is a real finding; report it without weakening Noticed. An impossible step,
wrong atomic boundary, or unsupported fairness premise is a modeling error: correct
the mapping, retain the finding history, and rerun every config. Intended behavior
changes require both the source change and corresponding model update.

Scope: one PR, one lead and trusted orc; nudges bounded to 0..2. CI, action, unhold
and nudge have weak fairness. No clock, timer deadline, network outage, delivery,
scheduler liveness, review approval, or successful fix/merge is proved. Handoff is
an abstract outcome, not an atomic watch-transfer implementation. Passing TypeOK
only checks domains. A merged terminal state intentionally has no next action, so
the rerun command disables deadlock checks.

To prove the command is sensitive to real source changes, save the sentinel file,
temporarily disable orphan escalation in `scan`, and rerun. The source regressions
must fail (exit 2). Restore the exact bytes in a `finally` block and rerun: only
the documented model findings may remain. Never commit the scratch mutation.
