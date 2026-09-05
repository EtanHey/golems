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

`green_autocursor_runner.py` import-guards
`skills/golem-powers/cursor-workflows/lib/autocursor.py`. The library is being
built in parallel, so the deterministic gate records whether it is available but
does not require it in replay mode.
