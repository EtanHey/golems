# Analyze Workflow

`analyze.py` turns gathered findings into a structured synthesis without using web
access or LLM-inference APIs. All reasoning calls go through the existing
`lib.autocursor.agent()` wrapper around headless `cursor-agent`.

Input is the gather finding shape:

```json
[
  {
    "id": "F1",
    "title": "Payment webhook fails on retry",
    "detail": "Retrying the webhook can enqueue duplicate jobs.",
    "evidence": ["payments.py:41"],
    "type": "bug",
    "importance": 5
  }
]
```

The workflow validates input, deduplicates near-identical findings locally,
asks Cursor for a cluster plan, fans out per-cluster analysis with
`autocursor.parallel()`, ranks by `importance * recurrence`, and asks Cursor for
one final paragraph. The returned object is validated against
`analyze.schema.json`.

Run from the repo root:

```bash
python3 skills/golem-powers/cursor-workflows/analyze/analyze.py findings.json --top-n 10
```
