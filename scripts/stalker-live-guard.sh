#!/usr/bin/env bash
# Compat shim (GO-6, 2026-09-25): moved to scripts/stalker/stalker-live-guard.sh; remove once the installed LaunchAgents are repointed and the pre-move watcher has restarted.
exec bash "$(dirname "$0")/stalker/stalker-live-guard.sh" "$@"
