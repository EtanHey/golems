# Gemini context

Gemini workers gather research, frames, inventories and verification evidence.
Shared rules remain in `AGENTS.md`. The gatherer routes its tier through
`/agent-routing`; this template does not select a model.

Antigravity 1.2.14 reads global agents from
`~/.gemini/antigravity-cli/agents`. `mainAgent: true` enables `--agent gatherer`;
`subagent: false` keeps this a primary gatherer session. The launcher adds that
agent for `--worker` or inherited `GOLEM_ROLE=worker` when installed, and warns
while preserving the existing launch if it is missing. Leads use their existing
launch flow. Model defaults remain owned by the launcher's routing policy.

A lead persona belongs in `~/.claude/agents/<name>.md`, injected through the
registry's `projects.<project>.agentByCli.gemini` mapping. Other engines retain
the existing `agent` fallback. Workers never receive that lead context.

## Installer

Run `bash scripts/install-gemini-context.sh --host mbp` on the MBP, or use
`--host m1` on the M1. The host is a report label; it does not select an SSH
target. The installer uses `RALPH_REGISTRY_FILE`, then the generated repoGolem
registry, then the legacy Ralph registry. `--registry <file>` selects an explicit
resolved registry. It never generates a registry or resolves secrets.

The default prints a table without writing. `--check` also fails for ritual
patterns in global or repo context. `--apply` installs context and the global
gatherer. `--check` and `--apply` are mutually exclusive. Global GEMINI.md is
only verified; a global ritual blocks apply.

Existing repo files identical to CLAUDE.md and at most 200 lines are treated as
stale copies. Larger copies and other existing content are conservatively marked
`REVIEW` and kept unless `--force-repo <registered-name>` is
supplied. Missing repos and symlinked repo context or parents get per-repo skip
rows. Registry aliases for one destination are deduplicated; a force on any
alias applies to that destination. Device boot descriptions, bootstrap paths,
reboot timers, and ordinary `brain_recall` mentions are not agent rituals.

Existing replacements are backed up under
`~/.golems/backups/gemini-md/<timestamp>/`; filenames include the repo or agent
name and a canonical destination-path hash, so case-insensitive names cannot
collide. Backups are created exclusively and verified byte-for-byte before any
replacement. Every target and backup directory is checked for writability;
all replacement and rollback files are staged before committing any target.
Each rename is atomic and writes use mode 0600. If a write or rename fails,
already-committed targets are restored from verified backups, newly created
files are removed, and the command exits non-zero with a result table. Backups
remain available; if rollback itself fails, its destination is explicitly
reported for manual restoration. To restore manually, copy the relevant backup
to its original destination.

For a private lead persona, supply `--lead-persona <source> --lead-agent <name>`.
This installs the separate persona and prints the required registry mapping;
the installer does not edit registry configuration. Apply on both Macs after
merge, then verify fresh Gemini worker sessions and their verbose agent/context
load logs. Source tests and dry-run tables do not establish live worker behavior.
