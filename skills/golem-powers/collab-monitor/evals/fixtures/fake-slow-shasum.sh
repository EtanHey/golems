#!/usr/bin/env bash
set -euo pipefail

sleep "${COLLAB_MONITOR_SLOW_SHASUM_SECONDS:-0.025}"
exec /usr/bin/shasum "$@"
