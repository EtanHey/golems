#!/usr/bin/env bash
# frustration-capture — install / refresh the wired UserPromptSubmit hook as an
# INSTALLED COPY (never a symlink into a working tree, which would make the live
# hook whatever branch happens to be checked out). Thin wrapper over the shared
# installer so every wired hook follows one procedure.
#
#   scripts/install.sh          # copy source -> ~/.claude/hooks/frustration-capture
#   scripts/install.sh --check  # report drift only; exit 1 if stale
#
# Re-run after merging a change here — a merge does not deploy the hook.
#
# --fail-open: this is a UserPromptSubmit ENRICHER, not a security gate. A
# fail-closed shim here would block every prompt in the fleet if the installed
# copy went missing, which is far worse than the missed capture.
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/../../_shared/install-wired-hook.sh" \
  --skill frustration-capture --hook hooks/frustration-capture-prompt.py \
  --legacy frustration-capture-prompt.py --fail-open "$@"
