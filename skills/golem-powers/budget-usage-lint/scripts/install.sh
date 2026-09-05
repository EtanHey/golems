#!/usr/bin/env bash
# budget-usage-lint — install / refresh the hook as an INSTALLED COPY (never a
# symlink into a working tree). Thin wrapper over the shared installer.
#
#   scripts/install.sh          # copy source -> ~/.claude/hooks/budget-usage-lint
#   scripts/install.sh --check  # report drift only; exit 1 if stale
#
# --fail-open: this lint is advisory and always exits 0; it must never become a
# blocker just because its installed copy went missing.
#
# NOTE: this hook is prepared but NOT wired in ~/.claude/settings.json.
set -euo pipefail
HERE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/../../_shared/install-wired-hook.sh" \
  --skill budget-usage-lint --hook hooks/budget-usage-lint.py \
  --fail-open "$@"
