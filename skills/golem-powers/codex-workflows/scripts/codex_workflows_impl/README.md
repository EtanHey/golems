# Codex workflow internals

Callers keep using `../codex_workflows.py` or `../codex-workflows.sh`.
The Python facade retains the original signatures, command defaults and explicit
re-exports. These modules are implementation details:

| Module | Owns |
| --- | --- |
| config | Validation, constants, executable configuration, default run root |
| worktrees | Git calls, branch discovery, artifact path validation |
| manifest | Atomic JSON writes and advisory-lock updates |
| logs | Log headers and completed event interpretation |
| process | Process identity and launch evidence |
| workers | Launch preparation, startup, finalization and cleanup |
| runs | Watching, completion proof and artifact harvesting |
| composition | Spec validation and parallel/pipeline ordering |
| cli | Argument parsing and command dispatch |

The facade loads the sibling package from the entry's resolved filesystem path,
under a path-specific module name. Different installed/worktree copies keep their
implementation modules and `CodexWorkflowError` classes separate; repeated imports
from the same resolved location reuse that implementation. It does not modify
`sys.path`. Compatibility re-exports use explicit assignments (no F401 suppressions).

The facade resolves `CODEX_BIN`, `NOHUP_BIN`, and `DEFAULT_RUNS_DIR` per import.
It passes immutable executable configuration and explicit preparation callables
into workers, so overriding facade `create_worker_worktree`,
`preflight_launch_inputs` or `build_launch_argv` still affects launch.
Composition receives the facade's launch/watch functions. CLI dispatch receives
facade-bound launch, composition and parser actions. No implementation module
imports the facade or temporarily rewrites another module's globals.

Only the forwarding seams above are late-bound. Patching facade `watch_manifest`,
`harvest_manifest`, `cleanup_worker`, or `load_manifest` does not change CLI
watch/harvest/cleanup/status dispatch; those commands bind their implementation
imports directly. Likewise, patching facade `verify_launch`, `finalize_worker`,
or process helpers does not change calls inside launch/watch.

`tests/fixtures/split-contract.json` was captured from the unchanged entry at
51459cd3 before extraction. The characterization suite compares output bytes,
exit codes, signatures and serialized state; only its temporary fixture root is
normalized. The Python 3.11 override fixture preserves its older standard-library
formatting; both versions were captured from the untouched baseline. Golden
comparisons skip other Python minor versions with an explicit reason; behavioral
tests still run. Existing tests were retained unchanged. `test_cli_lifecycle.py`
uses a local executable fixture for the model provider and real Git, nohup,
process observation, worktrees, manifests and artifact files. This proves the
local workflow plumbing, not paid-provider execution or an installed fleet run.
