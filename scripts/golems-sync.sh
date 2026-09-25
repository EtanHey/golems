#!/usr/bin/env bash
# Compat shim (GO-6, 2026-09-25): moved to scripts/sync/golems-sync.sh; remove once runbooks and other repos' docs use the new path.
exec bash "$(dirname "$0")/sync/golems-sync.sh" "$@"
