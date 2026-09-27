# Stalker brain delivery

`stalker-brainlayer-telegram.sh` remains the public entry for `ingest-run`,
`queue-run`, and `digest`. It sources `store.sh`, `runs.sh`, and `digest.sh`
from its own directory. The Python payload and digest renderers run as
`python3 - ... < file` so the caller's argument order, stdin EOF, and
shell-facing command boundary match the original heredocs.

`payloads.py` builds ordered BrainLayer records. `store.sh` handles durable
record keys and retry state; `runs.sh` sequences ingest and queue operations.
`digest-data.py` reads and aggregates runs, and `digest-render.py` formats the
notification within the existing body limits. The digest renderer loads its
data module by the entry's real path, with a path-specific cache key. It does
not add to `sys.path`; separate installed copies keep distinct module and
class identities. The shell sets `STALKER_DIGEST_DATA_PATH` because a Python
script read from stdin has no useful `__file__` path. Direct execution of
`digest-render.py` uses its adjacent data file.

The data module is loaded when `main` runs, not when the renderer is imported.
The narrow traceback formatter keeps the original stdin frame locations for
the characterized processed and unprocessed `gems.md` read errors (and the
same unprocessed `chat.log` read error) while leaving Python's library frames
and exception text intact.

`scripts/tests/brain-delivery-contract.py` compares stdout, stderr, exit
status, command boundaries, and all final emitted files with untouched-base
goldens. `test-brain-delivery-isolation.py` checks two simultaneous copies.
