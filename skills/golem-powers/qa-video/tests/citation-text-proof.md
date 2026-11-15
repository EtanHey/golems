# Citation text regression proof

Change kind: bounded parser regression. No model, gateway or paid call.

Run from the qa-video skill directory:

```sh
uv run --offline --with pytest python -m pytest -q tests/test_visual_citation_text.py
uv run --offline --with pytest python -m pytest -q tests
```

Round 1 used master `e22387e357d430f3b37209b56b23f3b6e9ee3821`:
its original 33 synthetic cases were **18 failed, 15 passed** on master and
**33 passed** on `b9499452`. The initial full suite had **1 failed, 285 passed,
7 subtests passed** in the unchanged dense-slot one-second intermediate-log
assertion; the unchanged rerun had **286 passed, 7 subtests passed**.

Round 2 addresses all three independent review notes. The revised 63 synthetic
cases are **24 failed, 39 passed** on unchanged `b9499452`, then **63 passed**
on the corrected parser. The previous bare-`x` INVALID expectations now assert
READ to preserve master behaviour, as directed in review. Existing malformed
numeric ranges, out-of-range indexes and unclosed-quote controls remain INVALID.
No private observations, images or paths appear in the tests.

The final rules are:

- Strip the five existing quote forms within each line, preserving unclosed
  quote contents for validation. Straight-quote boundaries prevent an inch mark
  or a stray opener from pairing with the opening quote of a later label.
- Consume optional-plural `(s)` on tile/frame labels, so following indexes and
  ranges are parsed and checked. Ordinary `frame(s)` prose remains READ.
- Preserve bare `frame x` prose as READ; retain existing malformed numeric
  citation and zero-based bounds checks.

The tests include same-line stray quotes, inch marks, all five multiline quote
forms, truly unclosed quotes, line-local conflict detection, optional-plural
numeric indexes/ranges and ordinary `x` prose.

Offline replay covers all 110 retained recorded attempts: all 100 prior READ
attempts stay READ, exactly two citation-text INVALID attempts become READ,
and seven FAILED plus one INVALID stay unchanged. All 110 round-2 returned
attempt objects equal the round-1 objects, including findings, state, cause,
warning metadata and offending indexes. Original receipt and image hashes are
verified before and after replay. Only the provider subprocess boundary is
replaced with its recorded failure envelope, and the freshness clock is anchored
just before each original receipt's modification time. Actual `read_sheet` and
`validate` run against original retained receipt/image/home paths. This is
recorded-attempt replay, not a live provider or a newly run retry. Private
per-attempt receipts remain in the owner's local evidence directory.

Round-2 initial full suite: **1 failed, 315 passed, 7 subtests passed** in the
same unchanged dense-slot intermediate-log assertion. The timeout and lock
identity were present; no dense-slot source or assertion was changed.

Round-2 full-suite rerun without code/test changes: **316 passed, 7 subtests passed**.
