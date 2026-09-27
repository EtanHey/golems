# Convention audit internals

The original Python and shell entry paths remain the public interface. Internal
modules load from the entry's real path, isolated from other installed/worktree
copies without modifying sys.path. Explicit facade exports retain caller names.

- `detector.py`: SQLite recent-window inventory and traversal rules.
- `payloads.py`: structured payload validation and stable finding aggregation.
- `reporting.py`: telemetry, durable run-log JSON, and Markdown report bytes.
- `codex_runner.py`: worker records, pin verification and process execution.
- `audit.py`: lens prompts, fan-out/synthesis order and target-state guards.
- `cli.py`: parser, diagnostics and exit codes.

The facade owns model/effort defaults and passes immutable runner configuration.
Its command builder, pin verifier and process executor remain late-bound through
explicit callable arguments, including `_run_process` patches in existing tests.

Baseline goldens were captured from unchanged cfe1ab39;
only the fixture-root path is normalized, and clocks/revision are fixed inputs.

Audit receives the facade preflight/worker functions and lens mapping. CLI dispatch
receives the facade parser/audit functions. Other re-exports (detector/payload and
reporting helpers, prompt/git-state helpers) bind directly inside implementation
modules. Their facade names remain callable, but replacing those names does not
replace internal bindings. The shared standard-library time module still permits
clock freezing. Schema paths resolve from the original entry, including symlinks.
