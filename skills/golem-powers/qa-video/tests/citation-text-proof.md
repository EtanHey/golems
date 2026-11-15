# Citation text regression proof

Base: `e22387e357d430f3b37209b56b23f3b6e9ee3821` (master at task admission).
Change kind: bounded parser regression. No model, gateway or paid call.

Run from the qa-video skill directory:

```sh
uv run --offline --with pytest python -m pytest -q tests/test_visual_citation_text.py
uv run --offline --with pytest python -m pytest -q tests
```

The new synthetic file on the unchanged base: **18 failed, 15 passed**.
The same file on the fixed parser: **33 passed**. Cases cover all five existing
quote forms, quoted malformed/out-of-range indexes, unquoted `frame(s)` and prose,
valid numeric ranges/lists, and malformed/out-of-range citations outside quotes.
No private observations, images or paths appear in these tests.

The parser removes quoted screen text with the same helper used for reader
conflict detection, ignores the optional-plural noun `frame(s)`, and rejects the
unquoted placeholder index `frame x`. Existing numeric/range syntax, zero-based
bounds checks and conflict rules remain in force.

Offline replay covered all 110 retained recorded attempts: all 100 prior READ
attempts stayed READ, exactly two citation-text INVALID attempts became READ,
and seven FAILED plus one INVALID stayed unchanged. Original receipt and image
hashes were verified before and after replay. Only the provider subprocess
boundary was replaced with its recorded failure envelope, and the freshness
clock was anchored just before each original receipt's modification time.
Actual `read_sheet` and `validate` ran against retained original receipt/image/home
paths. This is recorded-attempt replay, not a live provider or a newly run retry.
Private per-attempt receipts remain in the owner's local evidence directory.

The first full-suite run recorded **1 failed, 285 passed, 7 subtests passed**:
`test_tile_failure_cleans_partial_window[live]` hit its one-second wall-clock
deadline before printing its intermediate waiting message. Its expected timeout
and lock identity were present. Neither the test nor dense-slot source was changed.

Full-suite rerun without source/test changes: **286 passed, 7 subtests passed**.
