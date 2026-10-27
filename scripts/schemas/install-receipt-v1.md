# install-receipt/v1 — PR-A

`install-receipt-v1.mjs` exports the closed JSON Schema. The CLI uses the existing
Ajv dependency and registers `utc-time` for real UTC calendar timestamps.

```sh
node scripts/install-receipt.mjs validate receipt.json
node scripts/install-receipt.mjs write receipt.json
cat receipt.json | node scripts/install-receipt.mjs write -
node --test scripts/tests/install-receipt.test.mjs
```

Input must contain the schema fields shown in the test fixture. `write` assigns a
fresh UUID and UTC `written_at`, checks the local hostname/user, and returns the
stored receipt plus its `path`. It can downgrade LIVE but never promote a verdict.
Any present embedded commit, worktree pin or self-report commit differing from
`target.merge_sha` yields MISMATCH, even with a matching asset digest or MCP probe.
Owner status exit != 0, drift or settings_drift downgrades LIVE to
INSTALLED_NOT_ACTIVE: activation is unverified, rather than a proven SHA mismatch.
Existing FAILED/MISMATCH verdicts remain conservative. Commit SHAs and content
hashes must be lowercase hex; uppercase input is rejected by the schema.
For hooks-live, use `install_source.mode: worktree-pin`, `pin_sha`, and
`owner_status` from the owner installer's `--status`; no `release.json` is needed.

Writes go to `$HOME/.local/state/golems/install-receipts/<product>/` regardless
of XDG_STATE_HOME. Event names are `<UTC-timestamp>-<version>.json`; collisions
fail without replacing an event. An exclusive temporary file is linked into the
event name, then renamed atomically over `latest.json`. A failed latest update
can leave a complete event, never a partial latest receipt.
Under the single-writer rule, `latest.json` is last-rename-wins, not timestamp-ordered.
Symlinked directories below HOME are refused; HOME itself may be a symlink.
Keep this state local to each Mac, outside sync folders.

Unknown fields at every object level are rejected, including secrets, tokens,
transcripts, dictionary terms and BrainLayer content. Allowed text fields are
summaries and identity evidence only; callers must never put private content in
them. The CLI records supplied evidence; it does not run activation commands or
independently attest the reported installation. Cross-Mac `status` is PR-B.
