#!/usr/bin/env bash
# never-fabricate — install / refresh the wired stamp-lint hook as an INSTALLED
# COPY (never a symlink into a working tree, which would make the live hook
# whatever branch happens to be checked out). Thin wrapper over the shared
# installer so every wired hook follows one procedure.
#
#   scripts/install.sh          # copy source -> ~/.claude/hooks/never-fabricate
#   scripts/install.sh --check  # report drift only; exit 1 if stale
#
# Re-run after merging a change here — a merge does not deploy the hook.
#
# --fail-open: stamp-lint is a PostToolUse OBSERVER, not a security gate. If the
# installed copy ever goes missing the legacy shim warns on stderr and gets out
# of the way rather than wedging sessions.
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/../../_shared/install-wired-hook.sh" \
  --skill never-fabricate --hook hooks/stamp-lint.py \
  --legacy stamp-lint.py --fail-open "$@"
