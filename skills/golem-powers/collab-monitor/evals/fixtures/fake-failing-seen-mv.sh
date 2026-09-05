#!/bin/sh
set -eu

if [ -n "${COLLAB_MONITOR_FAIL_SEEN_MV:-}" ]; then
  case "${2:-}" in
    */seen.sha256) exit 7 ;;
  esac
fi

exec /bin/mv "$@"
