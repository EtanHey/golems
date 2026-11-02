---
name: m1-window-gate
description: Guard M1 dispatch and client seats during maintenance.
---
# M1 window gate

An M1 install blocks only work that touches what the install owns: its leased paths.
The leased list is the `LEASED` constant in the hook. It mirrors the M1 procedure's FIXED
lease list, HOME-relative: the skills roots under `.claude`, `.agents`, `.codex`, `.cursor` and
`.gemini/config`; `.golems/bin`, `vendor`, `current`, `release.json` and `release-history`;
`.claude/hooks`, `.claude/settings.json`, `.codex/hooks.json`, the golems install receipts and
the two `.golems/ratchet` files. `.golems/releases` stands in for the run's one target release.
A test pins the list, so a change is deliberate. Change it together with the procedure.

The `client` manifest explicitly selects `--mode seat`, independently of host
discovery. Seat mode checks `~/.golems/m1-procedure.lock` with one lstat when
absent, then ALLOWs without reading configuration or loading the shell parser.
Any lock blocks leased work: a real lock directory with a valid `owner.json`
(the procedure's exact SHA/timestamp stem and current UID), and equally a symlink,
a file, or a missing, unreadable or invalid owner.
Only a valid lock permits an exemption for a call carrying its exact stem or
`m1-golems-sync-<run label>-<UTC_TS>` lane. The label uses the same grammar as dispatch mode
(letters, digits and `.`, `_`, `:`, `-`, e.g. `run1`, `run2`, `run2.4`); the 20-digit timestamp must
equal the lock's stem. Prefix/suffix lookalikes do not qualify.

While a lock is held, a seat works normally outside the lease:

- **Write, Edit, MultiEdit, NotebookEdit** are denied only when the target is a leased path or
  inside one. The hook expands `~`, resolves a relative path against the payload `cwd`, counts any
  `/Users/<name>` home, and checks the lexical path, the path with symlinked parents resolved,
  and a final symlink's target (even a dangling one, since the write would create it). A leased
  path that is itself a symlink owns its target too. A path it can't resolve is denied.
- **Bash** read-only commands stay allowed: plain ls, cat, head, tail, wc, stat, ps, pgrep, uptime,
  df, du -s, git status/log/diff/show/rev-parse, grep/rg, non-mutating find, echo, date
  (optionally -u/+format), pwd and whoami, every pipeline/list command qualifying.
  Any other command is denied only when it:
  - names a leased path in any spelling (`~/…`, `$HOME/…`, `${HOME}/…`, `/Users/<name>/…`, or a
    relative path that resolves into one), or a directory that holds one (`rm -rf ~/.claude`);
  - runs with its `cwd`, or `cd`s, inside a leased path, or `cd`s into a directory under HOME
    that holds one (`cd ~/.golems && touch x`);
  - names a golems installer: `scripts/release/install.sh`, `install-hooks`, `golem-install`,
    `codex-hooks-install.mjs`, `client-install-transaction.mjs`, or the golems CLI's
    `update`, `wizard` or `skills install|update|uninstall`.
  A glob or variable counts as anything under its static directory. A command the shared
  parser (`_shared/shell_parse`) can't read, or a Bash call without a `cwd`, is denied.

Residual: a script or tool that writes leased paths without naming them (for example a
Python heredoc that builds the path from parts) is outside static inspection. Shell aliases,
functions and configured helpers are too. The procedure's own OWNED check (r5f) is the real
guard: it STOPs the run on any change to a leased path. This gate is a backstop, not a sandbox.

During an OPEN window, dispatch mode allows work sent to the M1 unless its text names a leased
path or a golems installer, with the same matcher. The remote cwd is HOME, so a bare
`.claude/skills` counts there. A `t3_thread_send` message to an M1 **lead** (a top-level thread:
an `mcp:…` or `import:…` id, or a bare UUID) in `auto`, `queue` or `steer` mode is allowed even
when it names a leased path; that lead's own seat gate guards the paths.

A denial is one plain line naming the leased path, for example: `Blocked: a golems install is
running on this Mac and owns ~/.claude/skills. Wait for it to finish, or work outside the
install's paths.`

The procedure itself runs `python3 -I -B -` over SSH stdin, outside agent tool
calls; no hook sees or changes that work. Crashed runs retain their lock until
the procedure releases it through completion, rollback or retirement.
Claude covers the listed file tools; Codex seat registration remains Bash-only,
so native apply_patch and other tools are outside this gate's Codex coverage.

The `mbp` entry retains default dispatch mode (also `--mode dispatch`):

The owner profile reads `~/.golems/m1-window-gate.json` (regular file, current
UID, mode 0600) with `schema: 1`, an absolute `registry` path, and string arrays
`m1_ssh_targets` and `m1_environment_ids`. Keep deployment values out of git.
No config means ALLOW. Installer status reports `m1-window-gate unconfigured`.
Invalid configuration or an unreadable registry denies identifiable M1 calls.
If configuration cannot be decoded, the public `m1` SSH alias and any recoverable
target arrays remain identifiable; lost custom mappings cannot be reconstructed.

Claude covers Bash and the manifest's T3 tools carrying `environmentId`, including
nested inputs. Codex's existing adapter accepts Bash/apply_patch only; this gate
registers Bash-only. Configured hosts match SSH destinations and remote copy
operands. Shared shell parsing distinguishes commands from quoted prose and
inspects substitutions and shell `-c` payloads. Arbitrary scripts, dynamic host
expansion, SSH config aliases absent from the config, and unregistered tools
remain outside static inspection. This is a dispatch backstop, not a sandbox.

Latest appended events win per lane and per WINDOW stem. Leased work passes an OPEN
window only when every still-open stem appears in the call, or the call carries that window's
own STARTED `m1-golems-sync-…-<UTC_TS>` lane. Other lanes and settled lanes do not qualify.
Closed windows allow calls silently. The gate prints nothing unless it denies.

The normal fail-open wrapper preserves deliberate exit-2 M1 denials. Global
`--fail-closed` would also block unrelated calls on launcher/import failure,
violating the scoped contract. Infrastructure failure therefore remains a known
fail-open boundary (the Codex transport itself retains its existing fail-closed
failure behavior). Installation and native-seat verification belong to the lead.
Run `python3 -m pytest skills/golem-powers/m1-window-gate/tests -q` for subprocess
RED/GREEN fixtures; they execute the hook, never SSH or a T3 dispatch.
