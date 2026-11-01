# LeadWait: does a red or green PR always get noticed?

`LeadWait.tla` models one PR, its owning lead, and an orc fallback. The property `Noticed` says
that every red or green PR that is not visibly held is eventually fixed, merged or visibly held.

The three switches are the fixes from the
[waiting policy](../../../skills/golem-powers/pr-loop/references/review-loop.md#waiting-policy-no-polling-turns):

- `EndTurnCheck`: the lead reads its open PRs before every turn ends.
- `Handoff`: settling a lead thread hands its PR watches to a live lead.
- `Sentinel`: pr-sentinel nudges the owner, then moves the PR to orc.

When a rule is off, the model still allows the lead to skip it (the action is possible but not
fair), because a written rule only works when it is followed.

| Config | EndTurnCheck | Handoff | Sentinel | TLC result |
|---|---|---|---|---|
| `Today` | off | off | off | violated: CI finishes → thread settled → never acted on |
| `WakeIgnored` | off | on | off | violated: CI finishes → lead takes the wake, does nothing |
| `SettleWithoutHandoff` | on | off | off | violated: settle drops the only watcher |
| `RulesFollowed` | on | on | off | passes, assuming every agent follows both rules |
| `SentinelOnly` | off | off | on | passes even when agents skip the rules |
| `RulesAndSentinel` | on | on | on | passes |

The takeaway: the rules fix it only while every agent follows them. The sentinel is the tool that
fixes it even when an agent doesn't.

Run it (TLC 1.7.4; `-deadlock` because a merged PR has nothing left to do):

```sh
tlc -deadlock -workers 1 -config Today.cfg LeadWait.tla
```
