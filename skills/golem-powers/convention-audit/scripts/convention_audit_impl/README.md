# Convention audit internals

The original Python and shell entry paths remain the public interface. Internal
modules load from the entry's real path, isolated from other installed/worktree
copies without modifying sys.path. Explicit facade exports retain caller names.

- `detector.py`: SQLite recent-window inventory and traversal rules.
- `payloads.py`: structured payload validation and stable finding aggregation.
- `reporting.py`: telemetry, durable run-log JSON, and Markdown report bytes.
- `codex_runner.py`: worker result records; execution moves in the next slice.

These are the leaf-module extraction slices; orchestration stays in the entry until
its own reviewed slice. Baseline goldens were captured from unchanged cfe1ab39;
only the fixture-root path is normalized, and clocks/revision are fixed inputs.
