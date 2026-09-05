# Agent Workflow

Use `agent` for one headless worker when cmux is unavailable or when a headless
run is explicitly requested. For a normal reachable single worker, use cmux.

## Launch

The brief must be an absolute path. Choose exactly one manifest target:

```bash
skills/golem-powers/codex-workflows/scripts/codex-workflows.sh agent \
  --repo $HOME/Gits/example \
  --name worker-a \
  --brief /absolute/path/worker-a-brief.md \
  --lead lead-name \
  --run-id example-r1 \
  --model gpt-5.6-luna \
  --effort xhigh
```

`--run-id ID` maps to `<run-dir>/<ID>/manifest.json`. Use `--manifest
/absolute/run/manifest.json` instead to create or append to that explicit run;
the repository, run, and lead identities must match.

The harness sends this pointer prompt:

```text
Read and follow /absolute/path/worker-a-brief.md. End with TASK_DONE on its own line.
```

The repository common Git directory and the brief directory are passed through
`--add-dir`; add writable report destinations with repeated `--report-dir`.

## Watch and Harvest

```bash
skills/golem-powers/codex-workflows/scripts/codex-workflows.sh watch \
  --run-id example-r1 \
  --watch-timeout 3600

skills/golem-powers/codex-workflows/scripts/codex-workflows.sh harvest \
  --run-id example-r1
```

`watch`, `status`, `harvest`, and `cleanup` accept either `--run-id` plus an
optional `--run-dir`, or an explicit `--manifest`. With `--run-id`, harvest
defaults to `<run-dir>/<run-id>/harvest`; pass `--output-dir` to choose another
durable destination.

Declare expected worker outputs with repeated worktree-relative `--artifact`
patterns. Absolute paths, `..`, symlinks, and resolved escapes are rejected.
Harvest searches gitignored paths inside the worktree too. An artifact path is
not a shared-repository destination: harvest copies it to
`<output-dir>/<worker>/artifacts/<worktree-relative-path>`.

## Cleanup

Cleanup refuses live or unharvested workers. Branch deletion also refuses
unmerged work unless the caller explicitly opts into the force policy:

```bash
skills/golem-powers/codex-workflows/scripts/codex-workflows.sh cleanup \
  --manifest /absolute/run/manifest.json \
  --worker worker-a \
  --delete-branches
```
