#!/usr/bin/env bash
# tmp-block — install / refresh the wired PreToolUse guard as an INSTALLED COPY.
# Thin wrapper over the shared installer so this security gate cannot drift from
# the fleet's install procedure. See hooks/INSTALL.md.
#
#   scripts/install.sh          # copy source -> ~/.claude/hooks/tmp-block, then probe
#   scripts/install.sh --check  # report drift only; exit 1 if stale
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/../../_shared/install-wired-hook.sh" \
  --skill tmp-block \
  --hook hooks/tmp-block-pretooluse.py \
  --legacy tmp-block-pretooluse.py \
  "$@"
