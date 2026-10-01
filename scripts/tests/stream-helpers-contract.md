# Stream helper characterization

`bats scripts/tests/test-stream-helpers.bats` includes the byte-golden harness.
It launches `/bin/bash` (Bash 3.2 on macOS), independently for each scenario,
from an unrelated working directory. `STREAM_CONTRACT_BASH` selects another
Bash executable. Every case also runs from a copied library tree.

Fixtures were captured from untouched commit
`70b7833f91f3cf2f683214829fc15baf775bc4a7`, before extraction. The recorder
requires that base's exact `stream-helpers.sh` and `portable-stat.sh` bytes:

```sh
python3 scripts/tests/stream-helpers-contract.py --record PATH_TO_BASE_TREE
```

Do not regenerate fixtures from the candidate. Normal runs compare stdout,
stderr, exit status, and every sandbox file, including command argv/stdin
traces, media output, queued JSON, failure logs and stage markers. JSON payloads
are compared as emitted, never parsed and serialized again. Only sandbox and
library roots and validated queue filename PID/random components are replaced.
Date and network/model/media commands are stubs; nothing sends a notification.

The source scenario pins the entire `declare -F` list (including private and
portable-stat helpers), no output on source, original lib directory meaning,
caller arguments, cwd, shell options, and the EXIT trap. Failure scenarios pin
Bash's distinct direct/conditional errexit contexts. Existing Bats cases retain
real fixture-child process termination and watchdog coverage.

Before extraction, changing Telegram JSON indentation from 2 to 1 in a separate
base copy failed `notifications-success`. The lead/reviewer must additionally
run an independent mutant before approval, per the split plan.

On 2026-10-01, the approved Telegram retirement projects failure-send records
and their alert-only markers out of the immutable `ad926ea1` fixtures. Remaining
command traces, file bytes, exit status, and output checks stay exact. This
projection does not record candidate output; actual captures remain unfiltered.
