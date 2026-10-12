# Hooks from an unpacked release

After verifying and extracting a P1 release, install the client profile:

```sh
node "$HOME/.golems/current/scripts/hooks/install-hooks.mjs" \
  --host client --source "$HOME/.golems/current" --apply
node "$HOME/.golems/current/scripts/hooks/install-hooks.mjs" \
  --host client --source "$HOME/.golems/current" --status
```

Omit `--apply` for a dry-run. Python 3.11+ and Node are required. The client
installer makes no git calls and creates no worktree. It refuses an existing
owner pin or hooks linked into `.worktrees/hooks-live`. When `scutil` is available,
it also refuses the owner's MBP/M1 hostnames; other hosts and absent `scutil`
remain supported. It verifies P1's `MANIFEST.json` hashes and modes and, when
present, its hash in `~/.golems/release.json` (`manifest_sha256`). It rejects extra
hook/import files and links Claude hooks and Codex commands to the resolved release directory. Updating the
`current` link requires re-running the hook installer to select the new release.
Use the release updater for updates; `--update`, `--restore-live` and `--manifest`
belong to the owner checkout path and are refused with `--source`.
If a registered shell guard reports an unavailable policy hook, rerun the
release installer and the client hook command above.

The `client` manifest profile installs tmp-block, git-guardian and human-confirm.
Entries with `ownerOnly: true` are skipped with a printed reason. Installation
and status print `private_gate: skipped (client host)`; the hook-specific receipt
is `~/.claude/hooks/golems-hooks-release.json`. The owner's MBP/M1 profiles and
private regression gate retain their existing behavior without `--source`.

The archive omits pytest suites. Before configuration writes, the shipped
`release-self-check.mjs` runs 12 public allow/deny specimens through the release's
Claude launcher and Codex adapter, then the installer verifies the source again.
These are policy smoke tests; they do not replace the owner's full suites or
native Mac ratchet rows.

Status `drift=0` means release content, links and registrations match. It reports
Codex trust separately and never writes `config.toml` or creates trust. Review
`/hooks` from plain Codex and verify native denial before calling a seat guarded.
The release checks prove a no-token lease is denied by human-confirm. Approved
token authorization still uses the gate's git-bound anchor contract and is not
supported or proven for a release with no checkout.
