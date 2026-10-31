#!/usr/bin/env bash
set -euo pipefail
[[ $# -ge 1 && $# -le 1 ]] || { echo 'usage: coverage-count.sh <workdir>' >&2; exit 2; }
exec python3 "$(dirname "$0")/provenance.py" coverage-count "$@"
