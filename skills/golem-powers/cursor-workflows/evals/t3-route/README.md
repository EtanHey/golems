# W30 route eval

Status: ITERATE / draft review. One positive case, five reps per arm; Sonnet 5.5, medium, API-key auth. Every startup audit PASS. Stubs dispatched nothing.

| Assertion | origin/master | Final SKILL overrides |
|---|---:|---:|
| First Cursor dispatch uses providerInstanceId cursor | 0/5 | 5/5 |
| No headless/AutoCursor/background-runner plan or call (manual review of recorded tool events and final text) | 5/5 | 5/5 |
| Full target includes model default | 0/5 | 1/5 |

Baseline already used T3 (driverKind cursor), so this is an exact target-field improvement, **not evidence that baseline chose AutoCursor**. No false-trigger or unchanged-control run: NOT_RUN. No native Cursor execution: NOT_RUN.

Final candidate cost $0.1722785; baseline $0.2176102. Earlier candidate five reps cost $0.1760793; total $0.565968, below $2.50. Earlier candidate excluded the subsequently edited weave SKILL, so it is not the final comparison.

Catalog at ec59a648; candidate uses skill surfaces for agent-routing, cursor-workflows, large-plan, pr-loop, repogolem, weave. Catalog-cell only replaces SKILL.md bodies: edited references/adapters are not injected. Read/Glob/Grep/Bash unavailable; existing brief paths described by the seat fixture. Real captured delegate schema supplied as tool-desc inventory. The harness still returns its legacy capabilities string (Cursor auto only, never pass a model); four final reps omit the requested model default sentinel. This is a harness limitation, retained as an unmet assertion. Per-cell child-visible hard cap $0.25 was deliberately enabled to bound spend; it may affect behavior. No model-judge call or automatic semantic pass is claimed.

Results carry per-record integrity hashes and effective model/auth/audit data. Local raw records and harness scripts remain under the skill-creator W30 report directory. The hashes establish integrity only.
