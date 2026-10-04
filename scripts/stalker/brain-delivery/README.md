# Stalker brain delivery

`stalker-brainlayer.sh` remains the public entry for `ingest-run`,
`queue-run`, and `digest`. It sources `store.sh`, `runs.sh`, and `digest.sh`
from its own directory. The Python payload and digest renderers run as
`python3 - ... < file` so the caller's argument order, stdin EOF, and
shell-facing command boundary match the original heredocs.

`payloads.py` builds ordered BrainLayer records. `store.sh` handles durable
record keys and retry state; `runs.sh` sequences ingest and queue operations.
`digest-data.py` reads and aggregates runs, and `digest-render.py` formats the
digest within the existing body limits. The digest renderer loads its
data module by the entry's real path, with a path-specific cache key. It does
not add to `sys.path`; separate installed copies keep distinct module and
class identities. The shell sets the internal `STALKER_DIGEST_DATA_PATH` only
for the renderer subprocess because a Python script read from stdin has no
useful `__file__` path. Direct execution of
`digest-render.py` uses its adjacent data file. Loading the data module
temporarily disables bytecode writes so digest calls do not create a checkout
`__pycache__` directory.

The data module is loaded when `main` runs, not when the renderer is imported.
Digest failures use native tracebacks. Frame locations are diagnostic, while
the final exception line, exit, digest title/body and artifacts are
checked against the untouched base.

`scripts/tests/brain-delivery-contract.py` compares stdout, stderr, exit
status, command boundaries, and all final emitted files with untouched-base
goldens. `test-brain-delivery-isolation.py` checks two simultaneous copies.

The digest subcommand always prints its existing title/body to stdout and returns
the renderer status. It sends no message. `--dry-run` remains accepted; BrainLayer
dry-run aliases affect ingestion only.
