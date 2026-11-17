# Tool-free Claude reader (default gatherer)

The default gatherer is `scripts/claude-image-helper.py`. `visual-batch.py` selects it automatically and resolves the concrete `claude.subagent.cheap` model from `standards/model-roles.json`; an explicit `--model` wins. Direct helper calls must pass that resolved model. It attaches PNG/JPEG bytes through stream-json with `--tools ""`, no MCP and no Read tool. The historical kit's Claude reader required Read and is not an image-only replacement. A brief naming Gemini explicitly may select `--helper scripts/visual-gather.py --model <named concrete ID>`; Gemini is never an automatic fallback.

The helper creates a disposable HOME and settings, carries no OAuth/config from the host, forwards only an explicitly provided ANTHROPIC_API_KEY and optional ANTHROPIC_BASE_URL, and retains session paths in helper-receipts. No real key should be written in an eval repo. It does not load any key file. Startup policy is the evaluator's responsibility: audit the retained session with an empty tool/MCP/instruction allowlist before admitting a paid run. The image is task data, never instructions.

A no-key startup may PASS isolation while inference fails authentication. That does not prove visual capability or task completion. The adapter requires exactly one init and one result; tools, MCP servers, skills and slash commands must all be empty. It rejects tool use, failed/denied results, model mismatch, malformed events (including null results), malformed/duplicate/missing/extra image rows and result text above 2000 characters. Each PNG/JPEG is capped at 5 MiB before launch. Receipts preserve failure type and session paths without copying raw credential-bearing diagnostics. No-key startup and synthetic CLI tests cost $0; live image reading remains a separate gate.

Example (only after independent cost and startup admission):

```sh
python3 scripts/visual-batch.py --workdir /absolute/eval/work --question 'Visible text only' /absolute/eval/frame.png
```

The helper accepts the same timeout range as visual-batch (0 < seconds <= 600). The provider bound is strictly shorter: it reserves one quarter of the remaining time, up to one second, for process cleanup and receipt writing. It also respects QA_VISUAL_DEADLINE. Timeout or SIGTERM stops and reaps the owned provider process group; the receipt names PROVIDER_TIMEOUT or HELPER_TERMINATED. Malformed responses have named failures and partial coverage, without a traceback or raw provider diagnostics. Known supplied-key text, including JSON-escaped text, is refused before output and redacted from the receipt. This does not replace the independent startup/session audit.

Paid visual inference is NOT_RUN for this adapter. Exact init.model equality fails closed on a provider alias; the actual paid model-string form and the 2000-character contract against real image output remain unproven. Synthetic tests and credential-free startup are separate evidence.

When an SRT is available, pass `--transcript <file.srt> --frames-tsv <frames.tsv>` to visual-batch (or this helper directly). The selected per-image `transcript_window` map travels as JSON task data beside the image bytes, never as instructions. The helper also accepts the batch’s preselected `--transcript-window` JSON. Missing transcript means the field is absent. See [transcript-window.md](transcript-window.md) for bounds, caps and timestamp semantics.
