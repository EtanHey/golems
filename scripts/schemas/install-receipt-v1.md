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
A differing embedded commit always defeats a matching release-asset digest.
For hooks-live, use `install_source.mode: worktree-pin`, `pin_sha`, and
`owner_status` from the owner installer's `--status`; no `release.json` is needed.

Writes go to `$HOME/.local/state/golems/install-receipts/<product>/` regardless
of XDG_STATE_HOME. Event names are `<UTC-timestamp>-<version>.json`; collisions
fail without replacing an event. An exclusive temporary file is linked into the
event name, then renamed atomically over `latest.json`. A failed latest update
can leave a complete event, never a partial latest receipt. Symlinked state
directories are refused. Keep this state local to each Mac, outside sync folders.

Unknown fields at every object level are rejected, including secrets, tokens,
transcripts, dictionary terms and BrainLayer content. Allowed text fields are
summaries and identity evidence only; callers must never put private content in
them. The CLI records supplied evidence; it does not run activation commands or
independently attest the reported installation. Cross-Mac `status` is PR-B.
