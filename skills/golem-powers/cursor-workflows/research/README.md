# Quick-Deep-Research

Quick-Deep-Research is the v0.2 headline workflow for `cursor-workflows`: a cheaper, fast, thorough alternative to Gemini Deep Research. It is intentionally not SOTA. It favors broad search fan-out, a structured web graph, and explicit cross-checking over exhaustive long-horizon research.

## Usage

```python
from research import quick_deep_research

result = quick_deep_research(
    "Vector database benchmark claims",
    breadth=4,
    depth=2,
)

print(result["report"])
```

Return shape:

```python
{
    "report": "... cited text ...",
    "graph": {"nodes": [...], "edges": [...]},
    "claims": [...],
    "sources": [...],
    "usage": {...},
}
```

Intermediate artifacts are written to disk under `.quick-deep-research/<timestamp-topic>/` unless `run_dir=` is supplied:

- `00-queries.json`
- `01-search.json`
- `02-graph.json`
- `03-claims.json`
- `04-report.json`
- `result.json`

## NO-API Guarantee

No LLM inference API is used here. There are no Anthropic, OpenAI, Gemini, or Google SDK imports. All reasoning steps call the real `lib.autocursor.agent()`, which shells out to headless `cursor-agent` on the Cursor subscription.

Search also stays on the Cursor subscription. Quick-Deep-Research uses `cursor-agent` native web search/browse capability only. There is no paid external search API path, no search API key, and no HTTP search client.

## Search Backend

Default behavior:

- `make_search_backend()` returns `CursorNativeSearchBackend`.
- `CursorNativeSearchBackend` asks `cursor-agent` to use native web/browse capability and return structured source results.
- The `SearchBackend` protocol remains pluggable for tests or future non-paid, subscription-native implementations.

Explicit native selection:

```bash
python3 -c 'from research.search_backend import make_search_backend; make_search_backend("native")'
```

Tests inject fake native search backends or a fake `cursor-agent` binary, so unit tests never hit live network or a live model.

## Pipeline

1. `SEARCH`: Cursor derives diverse search queries, then the search backend fans them out through `autocursor.parallel()`.
2. `WEB-GRAPH`: Cursor builds source/entity/claim nodes and `supports` / `contradicts` / `mentions` edges. The graph is validated against `research.schema.json`.
3. `CROSS-REFERENCE / VERIFY`: Each claim is checked by multiple Cursor verifier calls inside `loop_until_dry()`. Claims must be verified across at least two sources. Support and contradiction are kept as a flagged conflict.
4. `SYNTHESIZE`: Cursor writes a cited report. Citation integrity is enforced: every verified claim must cite at least two verified source IDs, and the report must contain the corresponding `[Sx]` anchors.

## Verification

Unit tests:

```bash
pytest -q skills/golem-powers/cursor-workflows/research/__tests__/test_research.py
```

Deterministic smoke via the shared smoke harness:

```bash
node skills/golem-powers/cursor-workflows/research/smoke/run_smoke.mjs
```

The smoke runs a fake Cursor binary plus fake search twice, compares byte-identical pipeline output, and scores the replay through `$HOME/Gits/skill-creator/src/smoke-harness.js`.
