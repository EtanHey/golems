#!/usr/bin/env bash
# Public entry: every mode is independently supervised before Git/bootstrap work.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ -x /usr/bin/python3 ]]; then
  GC_BOOTSTRAP_PYTHON=/usr/bin/python3
else
  GC_BOOTSTRAP_PYTHON="$(type -P python3)"
fi
exec "$GC_BOOTSTRAP_PYTHON" "$SCRIPT_DIR/lib/worktree-gc-budget.py" supervise \
  "$SCRIPT_DIR/lib/worktree-gc-main.sh" "$@"
