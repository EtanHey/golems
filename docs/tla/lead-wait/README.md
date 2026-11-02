# LeadWait: does a red or green PR always get noticed?

`LeadWait.tla` models one PR, its owning lead, and an orc fallback. The property `Noticed` says
that every red or green PR that is not visibly held is eventually fixed, merged or visibly held.

The three switches are the fixes from the
[waiting policy](../../../skills/golem-powers/pr-loop/references/review-loop.md#waiting-policy-no-polling-turns):

- `EndTurnCheck`: the lead reads its open PRs before every turn ends.
- `Handoff`: settling a lead thread hands its PR watches to a live lead.
- `Sentinel`: pr-sentinel nudges a live owner once; its sweep escalates orphaned PRs to orc.

When a rule is off, the model still allows the lead to skip it (the action is possible but not
fair), because a written rule only works when it is followed.

| Config | EndTurnCheck | Handoff | Sentinel | TLC result |
|---|---|---|---|---|
| `Today` | off | off | off | violated: CI finishes → thread settled → never acted on |
| `WakeIgnored` | off | on | off | violated: CI finishes → lead takes the wake, does nothing |
| `SettleWithoutHandoff` | on | off | off | violated: settle drops the only watcher |
| `RulesFollowed` | on | on | off | passes, assuming every agent follows both rules |
| `SentinelOnly` | off | off | on | FAILS: ignored live owner never escalates |
| `RulesAndSentinel` | on | on | on | passes |

The rules work only while agents follow them. The current sentinel covers orphaned PRs,
but does not rescue a live lead that ignores its one nudge. The source-aligned model
records this bug instead of assuming the intended second escalation exists.

What the model assumes (so read the passes narrowly):

- **orc is the trusted fallback.** It stays live, never settles, never ignores a wake, and
  eventually acts (weak fairness on `Act`). The sentinel results hold only while that is true.
- **The sentinel eventually runs** (weak fairness on `Nudge`). There is no bounded response time.
  Grace periods are not modeled; the missing live-owner escalation is modeled explicitly.
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

The [statechart](statechart.md) explains all four violating configurations in plain
words and marks their counterexample states red. The three historical paths map to
[#1054](https://github.com/EtanHey/golems/pull/1054)'s end-turn, handoff and visible-hold
rules. [#1062](https://github.com/EtanHey/golems/pull/1062) adds draft-first review and
the live-worker check; it is not a separate model switch.

## Current finding: a live lead ignores the sentinel

SentinelOnly's shortest counterexample has four steps after the initial state:

1. CI finishes green and delivers a wake to the live lead.
2. The lead ignores the wake without visibly holding the PR.
3. The sentinel sends its one nudge.
4. The lead ignores that nudge; the unchanged PR then stays unattended forever.

The final design in [#1056](https://github.com/EtanHey/golems/pull/1056) sends only once
per head/state in `lead`; `scan` excludes LIVE owners. The old model instead invented
a second transition to orc. The `nudges = 0` guard now matches the real implementation.
This is a regression from the intended escalation design, not evidence that the
stronger requirement should be weakened.

Reproduce the source behavior without real GitHub/T3 requests or messages:

```sh
python3 docs/tla/lead-wait/reproduce.py
```

It calls the real `lead` and `scan` functions with fake external commands and a fake
clock, in three rounds spaced three hours apart. Every round reports
`destinations=['fixture-lead']`: exactly one message to the lead, none to orc.
This is source behavior evidence with mocked services, not live delivery evidence.
