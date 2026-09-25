#!/usr/bin/env bash
# Compat shim (GO-6, 2026-09-25): moved to scripts/sync/sync-config.sh; remove once runbooks and other repos' docs use the new path.
exec bash "$(dirname "$0")/sync/sync-config.sh" "$@"
