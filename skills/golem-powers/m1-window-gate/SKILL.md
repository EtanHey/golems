---
name: m1-window-gate
description: Guard M1-bound dispatch during an open maintenance window.
---
# M1 window gate

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
