#!/usr/bin/env bash
set -euo pipefail
[[ $# -ge 3 && $# -le 4 ]] || { echo 'usage: inspected.sh <workdir> <frame> <why> [finding-id]' >&2; exit 2; }
exec python3 "$(dirname "$0")/provenance.py" inspected "$@"
