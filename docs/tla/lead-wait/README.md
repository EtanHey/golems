# LeadWait: does a red or green PR always get noticed?

`LeadWait.tla` models one PR, its owning lead, and an orc fallback. The property `Noticed` says
that every red or green PR that is not visibly held is eventually fixed, merged or visibly held.

The three switches are the fixes from the
[waiting policy](../../../skills/golem-powers/pr-loop/references/review-loop.md#waiting-policy-no-polling-turns):

- `EndTurnCheck`: the lead reads its open PRs before every turn ends.
- `Handoff`: settling a lead thread hands its PR watches to a live lead.
- `Sentinel`: pr-sentinel nudges a live owner once, then escalates an unchanged actionable PR to orc; its sweep covers orphans.

When a rule is off, the model still allows the lead to skip it (the action is possible but not
fair), because a written rule only works when it is followed.

| Config | EndTurnCheck | Handoff | Sentinel | TLC result |
|---|---|---|---|---|
| `Today` | off | off | off | violated: CI finishes → thread settled → never acted on |
| `WakeIgnored` | off | on | off | violated: CI finishes → lead takes the wake, does nothing |
| `SettleWithoutHandoff` | on | off | off | violated: settle drops the only watcher |
| `RulesFollowed` | on | on | off | passes, assuming every agent follows both rules |
| `SentinelOnly` | off | off | on | passes: second escalation reaches trusted orc |
| `RulesAndSentinel` | on | on | on | passes |

The rules work only while agents follow them. The sentinel now also rescues an ignored
live-owner nudge by escalating an unchanged red/green/conflicting PR to orc after two
hours. TLC checks eventual action; the source regression tests check the timer and deduplication.

What the model assumes (so read the passes narrowly):

- **orc is the trusted fallback.** It stays live, never settles, never ignores a wake, and
  eventually acts (weak fairness on `Act`). The sentinel results hold only while that is true.
- **The sentinel eventually runs** (weak fairness on `Nudge`). There is no bounded response time.
  Grace periods are not modeled; the second live-owner escalation is modeled explicitly.
- **A hold eventually ends** (weak fairness on `Unhold`). A visible hold counts as resolution.
- **A handoff is abstract.** With `Handoff` on, `Settle` keeps a live owner. It models the outcome
  of a handoff, not a checked `watch_pull_request` transfer.
- **Acting on red is a fix attempt.** CI goes back to pending, and the model does not prove the fix
  works or that the PR ever merges.
- No fairness condition here is runtime evidence that a T3 watch fires.

Run it (tla2tools 1.7.4 jar, which reports itself as TLC2 2.19; `-deadlock` because a merged PR has nothing left to do):

```sh
tlc -deadlock -workers 1 -config Today.cfg LeadWait.tla
```

## Verify and read the paths

Use the project-local [verify-lead-wait skill](../../../.claude/skills/verify-lead-wait/SKILL.md).
Its one command runs real sentinel regressions and all configs:

```sh
python3 .claude/skills/verify-lead-wait/verify.py
```

The [statechart](statechart.md) preserves the four pre-fix counterexamples and the fixed escalation path in plain
words and marks their counterexample states red. The three historical paths map to
[#1054](https://github.com/EtanHey/golems/pull/1054)'s end-turn, handoff and visible-hold
rules. [#1062](https://github.com/EtanHey/golems/pull/1062) adds draft-first review and
the live-worker check; it is not a separate model switch.

## Regression history: a live lead ignores the sentinel

Before the escalation fix, SentinelOnly's shortest counterexample had four steps after the initial state:

1. CI finishes green and delivers a wake to the live lead.
2. The lead ignores the wake without visibly holding the PR.
3. The sentinel sends its one nudge.
4. The lead ignores that nudge; the unchanged PR then stays unattended forever.

The final design in [#1056](https://github.com/EtanHey/golems/pull/1056) sends only once
per head/state in `lead`; `scan` excludes LIVE owners. The old model instead invented
a second transition to orc. PR A ([#1091](https://github.com/EtanHey/golems/pull/1091)) added a `nudges = 0` guard to expose that source bug.
The [second-grace rule](../../../scripts/pr-sentinel/README.md) now implements the
missing transition, so the model removes that guard and SentinelOnly passes again.
Noticed was kept unchanged throughout.

Reproduce the source behavior without real GitHub/T3 requests or messages:

```sh
python3 docs/tla/lead-wait/reproduce.py
```

It calls the real `lead` and `scan` functions with fake external commands and a fake
clock, in three rounds spaced three hours apart. Before the fix every round reported
`destinations=['fixture-lead']`. Now the first round sends only to the lead, and rounds
two and three report `destinations=['fixture-lead', 'fixture-orc']`: one escalation,
no duplicate lead nudge or orc message.
This is source behavior evidence with mocked services, not live delivery evidence.
