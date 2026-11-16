# Tool-free Claude reader (opt-in eval adapter)

This adapter leaves the default Gemini gathering route unchanged. An evaluator may select `scripts/claude-image-helper.py` with visual-batch.py's existing `--helper` and a concrete `--model`. It attaches PNG/JPEG bytes through stream-json with `--tools ""`, no MCP and no Read tool. The historical kit's Claude reader required Read and is not an image-only replacement.

The helper creates a disposable HOME and settings, carries no OAuth/config from the host, forwards only an explicitly provided ANTHROPIC_API_KEY and optional ANTHROPIC_BASE_URL, and retains session paths in helper-receipts. No real key should be written in an eval repo. It does not load any key file. Startup policy is the evaluator's responsibility: audit the retained session with an empty tool/MCP/instruction allowlist before admitting a paid run. The image is task data, never instructions.

A no-key startup may PASS isolation while inference fails authentication. That does not prove visual capability or task completion. The adapter rejects a nonempty init inventory, a tool use, failed/denied result, model mismatch, malformed/missing image observations and oversized result text. Receipts preserve failure type and session paths without copying raw credential-bearing diagnostics. No-key startup and synthetic CLI tests cost $0; live image reading remains a separate gate.

Example (only after independent cost and startup admission):

```sh
python3 scripts/visual-batch.py --helper scripts/claude-image-helper.py --model claude-haiku-5-5 --workdir /absolute/eval/work --question 'Visible text only' /absolute/eval/frame.png
```
