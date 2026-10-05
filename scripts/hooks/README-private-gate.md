# Private hook regression gate

`install-hooks.sh --apply` verifies the selected immutable source before moving
the live pin or writing wrappers, links or host configuration. Status and dry-run
have no gate side effects; dry-run prints the command. Git errors and missing or
renamed guard files refuse installation.

Public suites cover the shared parser, temporary-path policy, repository policy
and Codex adapter. The local private suite lives in the real, untracked directory
`<repo>/docs.local/private-guard-suites/`. Only a fully absent root warns and
continues with public verification. A present but incomplete, malformed,
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
environment. A trusted runner plugin supplies the reviewed per-test ledger fixture.
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

Private logs, XML, candidate SHA and exercised guard/adapter hashes remain in
`docs.local/hooks-private-gate-runs`. No private specimens go into tracked files
or public CI. A source-gate pass does not prove host wiring or provider enforcement;
verify those separately after installation.
