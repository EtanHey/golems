# Cursor-Workflows Parity Eval

Deterministic acceptance gate for the Cursor-workflows gather harness. It proves
that the Cursor/AutoCursor gather output covers the frozen Claude gather anchors
without losing `loop_until_dry` behavior.

Run:

```bash
python3 skills/golem-powers/cursor-workflows/evals/parity/run_parity.py
```

The default gate is replay-only. It does not call `cursor-agent`, Claude, the
network, or any live model. The checked-in replay transcript is raw
cursor-agent-style NDJSON passed through the `skill-creator`
`src/smoke-harness.js` replay API by `smoke_replay_cursor.mjs`.
The harness is found at `SMOKE_HARNESS_JS`, else `$SKILL_CREATOR_ROOT/src/`,
else in a `skill-creator` checkout next to the main golems checkout (resolved
through `git rev-parse --git-common-dir`, so linked worktrees find it too). An
env var that is set but does not resolve fails the run. skill-creator is a
private repo: when no harness is found, the gate prints
`PARITY_EVAL SKIP: <reason>` and exits 0 instead of failing.

## What GREEN Means

- GREEN findings cover 100% of RED high-importance evidence anchors.
- GREEN validates every finding against `schema/finding.schema.json`.
- GREEN reports a token ledger and records Cursor flat-rate billing next to the
  Claude RED token cost.
- GREEN ran at least two gather rounds and caught `CW-HIGH-002`, which is seeded
  as a second-round-only finding.
- The single-pass replay fixture is evaluated against the same guard and must
  fail it. If a single-pass fixture ever satisfies the guard, the eval fails.

## Fixtures

- `corpus/` contains the frozen synthetic recon targets.
- `golden/expected.json` is the RED Claude-workflow reference set.
- `replay/cursor-agent.loop-until-dry.ndjson` is the GREEN replay.
- `replay/cursor-agent.single-pass.ndjson` is the negative control.

The AutoCursor engine was retired. `green_autocursor_runner.py` parses historical
recordings only and neither imports nor launches the engine. Replay scores those
recordings; it does not establish current T3 behavior.
