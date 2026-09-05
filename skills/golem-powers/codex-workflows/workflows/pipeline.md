# Pipeline Workflow

Use `pipeline` when later fan-out depends on earlier stages. Workers inside a
stage launch in parallel; `stages[N+1]` does not launch until every worker in
`stages[N]` exits and its finished log is parsed.

## Spec

```json
{
  "repo": "$HOME/Gits/example",
  "lead": "lead-name",
  "model": "gpt-5.6-luna",
  "effort": "xhigh",
  "continue_on_failure": false,
  "stages": [
    {
      "name": "gather",
      "workers": [
        {"name": "gather-a", "brief": "/absolute/path/gather-a.md"},
        {"name": "gather-b", "brief": "/absolute/path/gather-b.md"}
      ]
    },
    {
      "name": "synthesize",
      "workers": [
        {"name": "synth-a", "brief": "/absolute/path/synth-a.md"}
      ]
    }
  ]
}
```

## Run

```bash
skills/golem-powers/codex-workflows/scripts/codex-workflows.sh pipeline \
  --spec /absolute/path/pipeline.json \
  --run-id pipeline-r1 \
  --watch-timeout 3600
```

The default is fail-closed: a failed launch, worker failure, timeout, parser
failure, or incomplete completion stops the pipeline before the next stage.
Set `continue_on_failure: true` only when later stages are explicitly safe with
partial inputs; the manifest records that policy.
