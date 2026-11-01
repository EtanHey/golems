---
name: m1-window-gate
description: Guard M1 dispatch and client seats during maintenance.
---
# M1 window gate

The `client` manifest explicitly selects `--mode seat`, independently of host
discovery. Seat mode checks `~/.golems/m1-procedure.lock` with one lstat when
absent, then ALLOWs without reading configuration or loading the shell parser.
A real lock directory with an `owner.json` containing the procedure's exact
SHA/timestamp stem and current UID blocks heavy or mutating Bash and Write,
Edit, MultiEdit and NotebookEdit. Symlinks, files, missing/unreadable or invalid
owners also block mutation, naming an UNKNOWN stem when ownership is untrusted.
Only a valid lock permits an exemption for a call carrying its exact stem or
`m1-golems-sync-<run label>-<UTC_TS>` lane, where the run label is letters, digits and dots only
(`run1`, `run2`, `run2.4`; not `run_2` or `run-2`). Prefix/suffix lookalikes do not qualify.

During an OPEN window, dispatch mode still allows a `t3_thread_send` message to an M1 **lead**
(a top-level thread) in `auto`, `queue` or `steer` mode, so orc and leads can keep talking to it.
A send to a delegated child (`thread:delegated-task:…`, which starts a fresh task), a `restart`
send, attachments and every other dispatch tool stay blocked.

Seat Bash permits plain calls to ls, cat, head, tail, wc, stat, ps, pgrep, uptime,
df, du -s, git status/log/diff/show/rev-parse, grep/rg, non-mutating find, echo,
date (optionally -u/+format), pwd and whoami. Every pipeline/list command must
qualify. Redirects, substitutions, wrappers, dynamic arguments and options that
write files or invoke helpers are refused conservatively using `_shared/shell_parse`.
Existing shell aliases/functions and configured executable helpers are outside
static inspection; this is a maintenance backstop, not a sandbox.
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

Latest appended events win per lane and per WINDOW stem. Every still-open stem
must appear in the call, or the call must carry that window's own STARTED
`m1-golems-sync-…-<UTC_TS>` lane. Other lanes and settled lanes do not qualify.
Closed windows allow calls silently. The gate prints nothing unless a window is OPEN.

The normal fail-open wrapper preserves deliberate exit-2 M1 denials. Global
`--fail-closed` would also block unrelated calls on launcher/import failure,
violating the scoped contract. Infrastructure failure therefore remains a known
fail-open boundary (the Codex transport itself retains its existing fail-closed
failure behavior). Installation and native-seat verification belong to the lead.
Run `python3 -m pytest skills/golem-powers/m1-window-gate/tests -q` for subprocess
RED/GREEN fixtures; they execute the hook, never SSH or a T3 dispatch.
