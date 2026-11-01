#!/usr/bin/env bash
set -euo pipefail
[[ $# -ge 2 && $# -le 2 ]] || { echo 'usage: coverage.sh <video> <workdir>' >&2; exit 2; }
exec python3 "$(dirname "$0")/provenance.py" coverage "$@"
