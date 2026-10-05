# Private hook regression gate

`install-hooks.sh --apply` verifies the selected immutable source before moving
the live pin or writing wrappers, links or host configuration. Status and dry-run
have no gate side effects; dry-run prints the command. Git errors and missing or
renamed guard files refuse installation.

Public suites cover the shared parser, temporary-path policy, repository policy
and Codex adapter. The local private suite lives in the real, untracked directory
`<repo>/docs.local/private-guard-suites/`. On the machine identified as `mbp` this directory is
required: absence or renaming refuses installation. Other hosts warn once for
a fully absent root and continue with public verification. A present but incomplete, malformed,
symlinked or failing suite refuses installation.

Its `manifest.json` declares suite content hashes and an exact case count:

```json
{
  "version": 2,
  "expectedCases": 96,
  "fixtures": [{"path": "/absolute/repo/docs.local/private-guard-suites/test_guard.py", "sha256": "FILE_SHA256"}],
  "dependencies": []
}
```

The suite list comes from this manifest, rather than public issue-specific names.
Fixtures and helper dependencies must be real files inside the private root.
The manifest binds their content, rather than a historical candidate revision.
Suites receive the selected candidate through `GOLEMS_GUARD_CANDIDATE` and the
existing source variables. Adapter tests load `scripts/hooks/codex-policy-hook.py`
from that candidate, never hooks-live or a development checkout.

The gate uses isolated Python and pytest outside the candidate tree, with an
explicit config, disabled candidate conftests and cleared selection/startup
environment. A trusted runner plugin supplies the reviewed per-test ledger fixture
and sends a completion receipt over a parent-owned pipe after pytest finishes reporting.
The nonce reaches the plugin through a consumed pipe, rather than the plugin file.
Only the parent writes the saved receipt. Its nonce,
observed case outcomes and XML hash must match the gate's result. This rejects
early-exit XML forgery. The gate detects regressions in reviewed candidates; it
cannot contain deliberately hostile code running inside the test process, which
could inspect or tamper with the plugin in memory.
It shares the heavy-suite mutex, honours `GOLEMS_HEAVY_LOCK`, and refuses
lock/load timeout. Run the installer outside a suite already holding the lock.
Suite timeouts and termination clean up the candidate worktree. XML receipts
require complete, passing cases; private count must match the manifest and be
at least 96. Public totals may include passing subtests without separate XML rows.
Failures, errors and skips refuse both suites. Hashes are checked before and after execution.

Ephemeral pytest fixtures use `HOME/docs.local/golems-guard-fixtures`, outside
the invoking checkout so real repository ancestry cannot alter fixture decisions.
Suite sources, manifests and receipts stay in the repository; no OS temp staging
is used.
Completed fixture directories are pruned after each run, retaining the latest five
and preserving active runs identified by PID and process start time. Dead or
PID-reused markers do not prevent retention cleanup. Durable suite sources and receipt logs are not pruned.
Isolated Python requires pytest in that interpreter's own site-packages, including
on M1; installing it only in the user site does not make it available to the gate.

Apply reads `scutil --get LocalHostName`, using the configured machine mapping
(`MacBook-Pro` → `mbp`, `Locals-MacBook-Pro` → `m1`). Unknown machines and
requested-host mismatches refuse; `REPOGOLEM_HOST` cannot override installation.
Git calls clear inherited `GIT_*`, disable fsmonitor/untracked cache and replace
objects; live checks explicitly bind the git directory and worktree.

Installation refuses local tracked changes, untracked files,
ignored files in hook directories and hidden index flags in hooks-live, including
when keeping the current pin or updating to the same revision. Resolve local
changes before retrying; the installer does not discard them. Untracked `.pyc`
and real `__pycache__` directories are derived, excluded from dirt and purged
before and after the gate and within the synchronous pin/checkout operation,
before relocking. Cache symlinks and tracked changes still refuse. New hooks use
`-B`; legacy hooks can recreate bytecode during the gate, so both purge points
are required. Dry-run and status never purge.

Private logs, XML, candidate SHA and exercised guard/adapter hashes remain in
`docs.local/hooks-private-gate-runs`. No private specimens go into tracked files
or public CI. A source-gate pass does not prove host wiring or provider enforcement;
verify those separately after installation.

Owner-pin gating remains independent of source verification: a `requiresPin`
entry with no committed owner fingerprint is refused, unlinked and deregistered,
while other verified hooks install. Source verification never grants owner approval.
Status retains recorded-pin, master ancestry, index/replace-ref and byte-for-byte
import checks; its Git subprocesses use the same scrubbed environment as apply.
One bytecode purge covers launcher import directories and the legacy hook roots.
