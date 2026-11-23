# Tool-free Claude reader (default gatherer)

The default gatherer is `scripts/claude-image-helper.py`. `visual-batch.py` selects it automatically and resolves the concrete `claude.subagent.cheap` model from `standards/model-roles.json`; an explicit `--model` wins. Direct helper calls must pass that resolved model. It attaches PNG/JPEG bytes through stream-json with `--tools ""`, no MCP and no Read tool. The historical kit's Claude reader required Read and is not an image-only replacement. A brief naming Gemini explicitly may select `--helper scripts/visual-gather.py --model <named concrete ID>`; Gemini is never an automatic fallback.

The helper keeps the signed-in user's HOME and optional CLAUDE_CONFIG_DIR and uses no `--bare`.
It never opens or copies credentials. `--safe-mode` disables CLAUDE.md, installed skills, plugins
and other customizations while retaining login; managed policy can still apply. A fresh cwd, private temp directory and explicit settings
still disable hooks, tools and MCP. Only explicitly configured API key/base URL/auth token/OAuth
environment values are forwarded, in memory. No key file is loaded. The optional API route works
only when a key is explicitly configured; no key is required for the signed-in session route.
This changes the old hermetic startup contract: login/config is available, and the receipt scope
says so. Do not claim empty host instructions or independent startup-isolation PASS.

Before reading, state the whole run's sheets × price estimate, including retries (default planning
allowance $0.10/sheet, not a provider tariff). Script entry points stop above $5 with COST_HOLD;
never evade it by splitting calls. Zero successful reads STOP with "no frames were read", no QA
verdict. Retain the failure receipts and ask the orchestrator for readers. The batch records
verdict_allowed:false; default.sh finalize checks minimum visual evidence before its other gates.

The adapter still requires exactly one init and one result; tools, MCP servers, skills and slash
commands must all be empty. It rejects tool use, failed/denied results, model mismatch, malformed,
duplicate, missing or extra rows and output over 2000 characters. Images are capped at 5 MiB.
Receipts retain valid read counts and current image hashes, but never enumerate the host's session
store. Known supplied credential values are rejected/redacted. Synthetic CLI tests cost $0;
real signed-in inference and paid image reading remain NOT_RUN for this change.

Example (after whole-run cost admission):

```sh
python3 scripts/visual-batch.py --workdir /absolute/eval/work --question 'Visible text only' /absolute/eval/frame.png
```

The helper accepts the same timeout range as visual-batch (0 < seconds <= 600). The provider bound is strictly shorter: it reserves one quarter of the remaining time, up to one second, for process cleanup and receipt writing. It also respects QA_VISUAL_DEADLINE. Timeout or SIGTERM stops and reaps the owned provider process group; the receipt names PROVIDER_TIMEOUT or HELPER_TERMINATED. Malformed responses have named failures and partial coverage, without a traceback or raw provider diagnostics. Known supplied-key text, including JSON-escaped text, is refused before output and redacted from the receipt. This does not prove hermetic startup isolation.

Paid visual inference is NOT_RUN for this adapter. Exact init.model equality fails closed on a provider alias; the actual paid model-string form and the 2000-character contract against real image output remain unproven. Synthetic tests and credential-free startup are separate evidence.

When an SRT is available, pass `--transcript <file.srt> --frames-tsv <frames.tsv>` to visual-batch (or this helper directly). The selected per-image `transcript_window` map travels as JSON task data beside the image bytes, never as instructions. The helper also accepts the batch’s preselected `--transcript-window` JSON. Missing transcript means the field is absent. See [transcript-window.md](transcript-window.md) for bounds, caps and timestamp semantics.

## Current-run admission

Before any helper/delegate reading, `default.sh plan` starts visual/run.json; after extraction,
`python3 scripts/reader-policy.py admit <workdir>` admits the whole dense/index.tsv. Above $5
writes COST_HOLD and stops. No index yet means PENDING. For targeted debrief stills pass ALL paths.
Pass `--admission <workdir>/visual/cost-admission.json` to direct helpers and batch delegates.
A missing/held/stale admission or changed/unlisted image is refused before provider launch.
Receipts and summaries carry the run ID, so byte-identical prior-run images cannot earn evidence.
Native gathering must have a matching non-error image tool_result; judge pointer-only reads are
excluded. `default.sh finalize` checks these conditions before its remaining evidence gates.
