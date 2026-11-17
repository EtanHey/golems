#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 || ( $# == 4 && "$3" == --transcript ) ]] || { echo 'usage: must-read-check.sh <workdir> <qa-report.md> [--transcript <judge-session.jsonl>]' >&2; exit 3; }
exec python3 "$(dirname "$0")/must-read.py" check "$@"
