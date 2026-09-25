#!/usr/bin/env bash
# Compat shim (GO-6, 2026-09-25): moved to scripts/ci/pr-size-labels.sh; remove once fleet briefs and skill copies use the new path.
exec bash "$(dirname "$0")/ci/pr-size-labels.sh" "$@"
