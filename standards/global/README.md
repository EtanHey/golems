# Global instruction layout

The instruction bodies live in a private repository, outside this public tree.
Supply a directory containing `AGENTS.md` and `LEAD.md` to the installer.
The public repository owns the installer, synthetic tests, and launch convention.

| Source | Installed destination | Loading |
| --- | --- | --- |
| `AGENTS.md` | `~/.codex/AGENTS.md` | Shared by both providers |
| Generated include | `~/.claude/CLAUDE.md` | `@~/.codex/AGENTS.md` |
| `LEAD.md` | `~/.codex/LEAD.md` | Explicitly read by lead launch prompts |

Lead prompts also name the repository's `LEAD.md`. Shared instruction files
never import either lead layer. The launch wording belongs to `/agent-routing`;
`/large-plan` points there.

```bash
python3 scripts/install-global-instructions.py \
  --source-dir "$GOLEMS_GLOBAL_SOURCE_DIR" --home "$HOME" --dry-run
```

`--source-dir` is required unless `GOLEMS_GLOBAL_SOURCE_DIR` is set. `--home` is
always required. With no mode, the installer defaults to a dry run.
Use `--apply` to install or `--check` to compare all three installed files
without writes (exit 0 for matching bytes, 1 for drift, 2 for an error).

Changed existing files are backed up under the specified HOME at
`.golems/backups/global-instructions/<timestamp>/` before replacement.
Repeating an unchanged install creates no backups or writes. Destination and
backup symlinks are refused. Bodies are copied byte for byte; the Claude include
is generated. The installer does not edit the source directory.

Source bodies include the marker-delimited fleet canon. Maintain that block with
`node scripts/ci/canon-drift-lint.mjs --install --installed "$GOLEMS_GLOBAL_SOURCE_DIR/AGENTS.md"`.
Run the same command with `--check` instead of `--install` to check for drift.
