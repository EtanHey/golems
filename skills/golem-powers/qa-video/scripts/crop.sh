#!/usr/bin/env bash
set -euo pipefail
[[ $# -ge 6 && $# -le 6 ]] || { echo 'usage: crop.sh <frame> <x> <y> <w> <h> <out>' >&2; exit 2; }
exec python3 "$(dirname "$0")/provenance.py" crop "$@"
