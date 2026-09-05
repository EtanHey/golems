# Parallel Workflow

Use `parallel` for N independent tasks. The harness validates the complete spec
before creating any worktree, then launches all `workers` before watching any of
them.

## Spec

```json
{
  "repo": "$HOME/Gits/example",
  "lead": "lead-name",
  "model": "gpt-5.6-luna",
  "effort": "xhigh",
  "workers": [
    {
      "name": "worker-a",
      "brief": "/absolute/path/a.md",
      "artifacts": ["reports/a.md"]
    },
    {
      "name": "worker-b",
      "brief": "/absolute/path/b.md"
    }
  ]
}
```

See `../references/composition.schema.json` for the full contract.
Every `artifacts` entry is worktree-relative. It does not name a shared path in
the source checkout.

## Launch Only

```bash
skills/golem-powers/codex-workflows/scripts/codex-workflows.sh parallel \
  --spec /absolute/path/parallel.json \
  --run-id fanout-r1
```

Verified launch-only dispatch records `completion_state: launch_only` and
`completion_proven: false`, prints an unmissable `LAUNCH_ONLY` diagnostic, and
exits 75. It never returns zero for unfinished work.

## Launch and Watch

```bash
skills/golem-powers/codex-workflows/scripts/codex-workflows.sh parallel \
  --spec /absolute/path/parallel.json \
  --run-id fanout-r1 \
  --watch \
  --watch-timeout 3600
```

With `--watch`, exit 0 requires every worker to finish with an exact assistant
`TASK_DONE`. Read and verify each finished log and declared artifact before
claiming the fan-out succeeded.

## Harvest

After a successful watch, copy every finished log and declared artifact with:

```bash
skills/golem-powers/codex-workflows/scripts/codex-workflows.sh harvest \
  --run-id fanout-r1
```

The default destination is `<run-dir>/<run-id>/harvest`. Each artifact lands at
`<run-dir>/<run-id>/harvest/<worker>/artifacts/<worktree-relative-path>`.
