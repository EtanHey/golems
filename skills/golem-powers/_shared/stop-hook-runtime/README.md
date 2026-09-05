# Stop hook runtime

This directory is the shared installed runtime for the five synchronous policy
Stop hooks:

- `false-green-gate`
- `monitor-law-gate`
- `fleet-wrap-gate`
- `qa-verdict-gate`
- `idle-dwell-gate`

`stop-hook-reader.mjs` reads the last 512 KiB of an oversized JSONL transcript
plus one boundary byte used to discard a partial first record, preserves
top-level durable state, and emits a private read receipt on the telemetry file
descriptor. The hook's public stdout remains the Claude Code decision schema.

`stop-telemetry.mjs` captures that stdout decision without changing it and
appends one `golems.stop-decision.v1` JSONL row. Rows classify the outcome as
`allow`, `block`, `advisory`, `skipped`, or `error` and include actual stdin,
transcript, state, and total bytes read.

The installed layout must preserve the relative imports:

```text
~/.claude/hooks/
├── _shared/stop-hook-runtime/
├── false-green-gate/
├── monitor-law-gate/
├── fleet-wrap-gate/
├── qa-verdict-gate/
└── idle-dwell-gate/
```

After merge, the hook owner can install the exact source trees without using a
mutable checkout:

```bash
git -C $HOME/Gits/golems fetch origin
git -C $HOME/Gits/golems archive origin/master:skills/golem-powers \
  _shared/stop-hook-runtime \
  false-green-gate monitor-law-gate fleet-wrap-gate qa-verdict-gate idle-dwell-gate \
  | tar -x -C $HOME/.claude/hooks
```

Live settings must only be changed in the separately approved post-merge step.
At that point, point each telemetry wrapper at
`~/.claude/hooks/_shared/stop-hook-runtime/stop-telemetry.mjs`, rerun the
behavioral installed-copy suite, and temporarily unwire QA and idle-dwell as
directed by the gate-owner procedure.

The blocking behavioral check can target the real installed tree without
writing fixtures into it:

```bash
STOP_HOOK_INSTALLED_ROOT=$HOME/.claude/hooks \
  bun test skills/golem-powers/_shared/stop-hook-runtime/evals/install-drift.test.mjs
```
