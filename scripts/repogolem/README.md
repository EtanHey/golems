# Standalone repoGolem installation

The public generator takes a user-owned YAML file through `--config` or
`REPOGOLEM_CONFIG`. Keep the real instance in a private repository. Secrets
in the file are `op://` references. Generation resolves them once and writes
`registry.json`, `launchers.zsh`, and `secrets.env` in
`~/.config/repogolem/generated`: 0600 files in a 0700 directory outside Git.
Resolved values are on disk; never commit them or copy them into logs.

Installation defaults to dry-run. Apply from the checkout explicitly (Bun must be installed):

```sh
bun scripts/repogolem/repogolem-config.ts install --config /path/to/private/repogolem/config.yaml --dry-run
bun scripts/repogolem/repogolem-config.ts install --config /path/to/private/repogolem/config.yaml --apply
```

The installer bundles the CLI into `~/.config/repogolem/runtime`, copies the
modular dispatcher beside it, and installs `~/.local/bin/repogolem`. It replaces
old launcher source lines with a managed block in `.zshrc`, exports the private
config path, and links `~/.golems/config.yaml` to that config. If the private
file supplies `machineSeatConfigs: {LocalHostName: <preserved YAML text>}`,
it writes an owned 0600 machine-config.yaml view and links the old path to
that view instead; `--host` can select a host explicitly. It requires the
existing `seatRegistry` block to be byte-identical, including `launcherPrefix`.
Shell and seat backups stay in `~/.config/repogolem`; installation runs no `op`
and no generation. Repeating installation preserves the first backup.

```sh
repogolem install --rollback --apply
```

Rollback verifies the managed block and seat link, preserves unrelated shell
edits, and restores legacy launcher sources and seats. A recovery journal is
written before changes; retry install or rollback after an interrupted attempt.
The installed runtime and CLI are retained.

In a new shell, the operator performs the first real generation:

```sh
repogolem generate
repogolem generate --check
```

Unattended launcher calls read cached data without sourcing secret assignments
as shell code or invoking `op`. A missing, stale, or non-private cache fails
before starting an agent. Legacy Ralph files remain available during the soak.

`repogolem sync m1 --dry-run` previews without SSH or `op`. Actual sync pulls
the private repository on M1, reads its LocalHostName, resolves that machine's
references on the sending Mac once, and streams the cache over SSH under
`umask 077`. The remote CLI must already be installed. Its generation uses
`--secrets-from` and never invokes `op`. An owner/mode check, symlink refusal,
and a new noclobber incoming file protect the transfer. Remote generation
refuses changed config/host stamps or incomplete cached references.

Sync selects the remote private repo from `--remote-repo`,
`REPOGOLEM_REMOTE_REPO`, or `syncTargets.m1.repo` in the private YAML.
The public tool has no fleet repository path default.
