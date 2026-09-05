#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
case "$payload" in
  /*) printf '%s' "$payload" | /usr/bin/shasum "$@" ;;
  *) exit 7 ;;
esac
