# Brain delivery characterization

The existing `test-stalker-brainlayer.bats` suite runs
`brain-delivery-contract.py`. Goldens come from untouched commit
`e180e9ee12cd4ed3ee3bb2c1353cb21bd9ebbf93`. The pre-retirement recorder is disabled: fixture updates use the approved
immutable-base projection described below.

Separate CLI subprocesses pin argv, stdin source/EOF boundaries, exit status,
stdout/stderr and every data file after each invocation. For digest exceptions,
the lead-approved volatile region is only traceback frame/source/caret lines;
the header and final exception line remain exact, along with stdout, exit and
all artifacts. The fake BrainLayer batch backend, custom store command and
store backend cannot reach real services. A fixed clock removes timestamp nondeterminism. Normalization is
limited to sandbox/tree/interpreter installation prefixes, queue filename
PID/random components, and that named traceback region; JSON payload/artifact
formatting is byte-sensitive.

Cases cover dry-run flags and both aliases, record order, successful and partial
stores, batch startup failures, repeated queue/retry idempotency, empty and
malformed inputs, healthy/empty/mixed digests and Python exceptions.
Processed/unprocessed digest exceptions, chat/ledger directories and an
unreadable `gems.md` have Python-version-specific fixtures (3.11 and 3.13);
unrecorded interpreter versions explicitly skip only those exception cases.
Payload exception bytes are common to both recorded interpreters.

Before extraction, changing queue `intended_brain_store` from true to false in
an isolated base copy failed the queue artifact comparison. The lead/reviewer
must run a separate independent mutant before approving the split.

2026-10-01 retirement projection: the immutable `ad926ea1` digest fixtures keep
the pinned dry-run title/body for ordinary stdout, remove only the transport
command/payload records, and retain exact status, exception and data bytes. The
transport-refusal case and alias-only invocation are retired. Usage changes only
the entry filename. Actual captures stay unfiltered; no candidate recording.
