# Stop hook runtime

This directory is the shared installed runtime for the three synchronous policy
Stop hooks (advisory since GO-5 E2; `monitor-law-gate` and `idle-dwell-gate`
were deleted in E1):

- `false-green-gate`
- `fleet-wrap-gate`
- `qa-verdict-gate`

`stop-hook-reader.mjs` reads the last 512 KiB of an oversized JSONL transcript
plus one boundary byte used to discard a partial first record, preserves
top-level durable state, and emits a private read receipt on the telemetry file
descriptor. The hook's public stdout remains the Claude Code decision schema.

When the Stop payload has `stop_hook_active: true` (Claude Code sets it when
this stop already follows a Stop-hook block), the reader returns a null
transcript without reading the transcript or state, so every gate allows.
Blocking again would only make the model retry the same stop.

`stop-telemetry.mjs` captures that stdout decision without changing it and
appends one `golems.stop-decision.v1` JSONL row. Rows classify the outcome as
`allow`, `block`, `advisory`, `skipped`, or `error` and include actual stdin,
transcript, state, and total bytes read.

The installed layout must preserve the relative imports:

```text
~/.claude/hooks/
├── _shared/stop-hook-runtime/
├── false-green-gate/
├── fleet-wrap-gate/
└── qa-verdict-gate/
```

They are installed by `scripts/hooks/install-hooks.sh`, which symlinks each
gate from the pinned `.worktrees/hooks-live` tree (so the relative imports
resolve into it) and never installs an E1-deleted gate.

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
