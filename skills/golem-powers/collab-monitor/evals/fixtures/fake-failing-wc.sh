#!/usr/bin/env bash
set -eu

marker="${COLLAB_MONITOR_WC_FAIL_ONCE_MARKER:-}"
if [[ -n "$marker" && ! -e "$marker" ]]; then
  : > "$marker"
  exit 1
fi

exec /usr/bin/wc "$@"
