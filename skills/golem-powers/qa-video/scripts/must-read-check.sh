#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 ]] || { echo 'usage: must-read-check.sh <workdir> <qa-report.md>' >&2; exit 3; }
exec python3 "$(dirname "$0")/must-read.py" check "$@"
