---
name: secret-write-guard
description: "Pre-write gate: secret-like files in Git worktrees require a successful git check-ignore before writing. Default outside repos."
---

# Secret write guard

Status: source policy; deployment and native seat proof are separate.

Secret-like basenames (requested and real, case-insensitive): `.env*` except
`.env.example` / `.env.sample`, `*.pem`, `*.key`, `*credentials*`, `*secret*`,
`id_rsa*`, `*.p12`. Real paths determine repository membership, including
symlinks in either direction. Tracked files fail Git ignore proof.

Claude/Cursor file tools, Bash/Shell redirects and tee are covered. Codex uses
the existing Bash/apply_patch adapter, including wrapped patches and moves.
Parsing and cwd/variable resolution reuse tmp-block and `_shared/shell_parse.py`.
Unknown targets, parent traversal, policy/Git/resolution errors and timeouts
deny. No secret content is read or logged; no bypass or bypass ledger exists.

Limits: interpreter writes, cp/mv/rsync, opaque programs, persistent-shell stdin,
Codex's omitted per-call workdir, untrusted/unregistered hooks and concurrent
path/ignore/symlink changes. Source tests do not prove installed enforcement.

## Later installation (lead-cleared; never during SEC1 implementation)

After review, merge and guarded-path parity receipts, from the root checkout:

```bash
bash scripts/hooks/install-hooks.sh --host mbp --update <reviewed-sha>
bash scripts/hooks/install-hooks.sh --host mbp --update <reviewed-sha> --apply
bash scripts/hooks/install-hooks.sh --host mbp --status
```

Use `client` for the client manifest. Open `/hooks` from plain `codex` without
`--profile` for persistent trust; never manufacture hashes. Prove unignored
deny and ignored allow on each native seat. hooks-live pins both this guard
and its tmp-block dependency.

Verification: `python3 -m pytest scripts/tests/test_secret_write_guard.py -q`.
