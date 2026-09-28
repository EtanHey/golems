#!/usr/bin/env bash
# Stand-in for the 1Password CLI in repogolem-config tests; CI never runs the
# real `op`. Handles only `op run [flags] -- <cmd...>`: every env var whose
# value is an op:// ref becomes "resolved:<ref>", then <cmd> runs.
#   FAKE_OP_LOG   append one line per invocation (the resolver spy)
#   FAKE_OP_FAIL  exit 1 without running <cmd>, as op does on a bad ref
#   FAKE_OP_MASK  resolve to op's masking placeholder instead
#   FAKE_OP_SUFFIX appended to every resolved value (quoting tests)
set -euo pipefail
[[ -n "${FAKE_OP_LOG:-}" ]] && printf '%s\n' "$*" >>"$FAKE_OP_LOG"
[[ "${1:-}" == run ]] || { echo "fake-op: only 'run' is supported" >&2; exit 3; }
shift
while [[ $# -gt 0 && "$1" != -- ]]; do shift; done
[[ "${1:-}" == -- ]] || { echo "fake-op: missing --" >&2; exit 3; }
shift
[[ -n "${FAKE_OP_FAIL:-}" ]] && { echo "[ERROR] fake-op: could not resolve a reference" >&2; exit 1; }
while IFS= read -r name; do
  value=${!name}
  [[ "$value" == op://* ]] || continue
  if [[ -n "${FAKE_OP_MASK:-}" ]]; then
    export "$name=<concealed by 1Password>"
  else
    export "$name=resolved:$value${FAKE_OP_SUFFIX:-}"
  fi
done < <(compgen -e)
exec "$@"
