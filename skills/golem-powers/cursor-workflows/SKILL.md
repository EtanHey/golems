---
name: cursor-workflows
description: Run Cursor-workflow gather/recon via AutoCursor primitives. Triggers: cursor-workflow, autocursor gather, cursor gather.
---

# Cursor Workflows

Use this skill when the request asks for a `cursor-workflow`, `autocursor gather`, or `cursor gather`: read-heavy reconnaissance that can run through headless `cursor-agent` instead of spending Claude orchestration tokens.

The implementation lives in `lib/autocursor.py` and is intentionally portable: no golems imports, no worktree mutation, and no v0 edit flows. Worktree isolation is deferred until mutating workflows exist.

## Primitives

- `agent(prompt, *, schema=None, label=None, timeout=900, resume=None, model=None)` runs one headless `cursor-agent -p --force --approve-mcps --output-format json <prompt>` on Cursor Auto. The implementation still exposes the legacy `model` parameter, but callers must leave it `None`; a non-`None` value is a live out-of-scope violation at `lib/autocursor.py:58-59` to remove in a separate lane, not an authorized escape hatch. Never pass `-m`/`--model` or a model field: pinned Cursor drains the shared subscription pool fast. With `schema`, AutoCursor appends a JSON instruction, validates harness-side, retries malformed output, and records raw NDJSON logs to disk.
- `parallel(thunks, *, concurrency=8)` runs a ThreadPoolExecutor barrier. Failed thunks return `None`. `MAX_CHILDREN` caps local concurrency.
- `pipeline(items, *stages)` flows each item through stages independently. A failed item becomes `None`.
- `phase(title)` prints an observability marker.
- `loop_until_dry(round_fn, *, dry_rounds=2, max_rounds=10)` keeps gathering until consecutive rounds add no new stable-keyed findings.

## Analyze

`analyze/analyze.py` takes gathered findings, clusters/ranks/deduplicates them, then produces a structured synthesis through `autocursor.agent(schema=...)`. This workflow is pure local analysis: no web, no search backend, and no external API.

## Quick-Deep-Research

`research/research.py` is the subscription-only research workflow from SPEC §8: cursor-native web search (NO exa, NO paid API) builds a web graph of sources, entities, and claims; cross-reference/verify flags conflicts instead of silently merging them; synthesis emits a cited report. Treat it as a cheaper, thorough+fast alternative to Gemini Deep Research, not as SOTA deep research.

All reasoning and search in these workflows must stay behind the NO-API law: use the `cursor-agent` subscription path only, with no Anthropic/OpenAI/Gemini/Exa keys or paid external APIs.

If one of these workflows exhausts the shared Cursor quota through its own
dispatch, report that dispatch as the cause; never present the resulting
`resource_exhausted` state as an external finding.

## Example

```python
from lib.autocursor import agent, parallel

schema = {
    "type": "object",
    "required": ["file", "findings"],
    "properties": {
        "file": {"type": "string"},
        "findings": {"type": "array"},
    },
}

results = parallel([
    lambda path=path: agent(f"Inspect {path} for TODOs and risks", schema=schema, label=path)
    for path in ["README.md", "AGENTS.md"]
])
```

Run the fuller example with:

```bash
python3 skills/golem-powers/cursor-workflows/scripts/example-gather.py README.md AGENTS.md
```
