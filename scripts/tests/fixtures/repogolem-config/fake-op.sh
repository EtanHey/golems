#!/usr/bin/env bash
# Stand-in for the 1Password CLI in repogolem-config tests; CI never runs the
# real `op`. Handles only `op run [flags] -- <cmd...>`: every env var whose
# value is an op:// ref becomes "resolved:<ref>", then <cmd> runs.
#   FAKE_OP_LOG   append one line per invocation (the resolver spy)
#   FAKE_OP_FAIL  exit 1 without running <cmd>, as op does on a bad ref
#   FAKE_OP_MASK  resolve to op's masking placeholder instead
#   FAKE_OP_SUFFIX appended to every resolved value (quoting tests)
#   FAKE_OP_BEFORE bash run while "resolving", i.e. after generate's pre-op
#                  checks and before its writes (race regressions)
set -euo pipefail
[[ -n "${FAKE_OP_LOG:-}" ]] && printf '%s\n' "$*" >>"$FAKE_OP_LOG"
if [[ "${1:-}" == signin ]]; then
  [[ "${FAKE_OP_SIGNIN_FAILURE:-}" == fail || "${FAKE_OP_SIGNIN_FAILURE:-}" == cancel ]] && exit 1
  [[ -n "${FAKE_OP_SIGNIN_OUTPUT:-}" ]] && { printf '%s\n' "$FAKE_OP_SIGNIN_OUTPUT"; exit 0; }
  [[ -n "${FAKE_OP_STATE:-}" ]] && : >"$FAKE_OP_STATE"
  [[ -n "${FAKE_OP_SIGNIN_HANG:-}" ]] && exec sleep 60
  if [[ -n "${FAKE_OP_MANUAL:-}${FAKE_OP_EXPORT:-}${FAKE_OP_REQUIRE_SESSION:-}" ]]; then printf 'export OP_SESSION_fixture="%s"\n' "${FAKE_OP_TOKEN:-synthetic-token}"; fi
  exit 0
fi
if [[ -n "${FAKE_OP_REQUIRE_SESSION:-}" && -f "${FAKE_OP_STATE:-}" && "${OP_SESSION_fixture:-}" != "${FAKE_OP_TOKEN:-synthetic-token}" ]]; then exit 7; fi
if [[ "${1:-}" != run ]]; then
  [[ -n "${FAKE_OP_HANG:-}" ]] && exec sleep 60
  [[ -n "${FAKE_OP_REQUIRE_DESKTOP:-}" ]] && [[ "${OP_BIOMETRIC_UNLOCK_ENABLED:-}" != true ]] && exit 8
  if [[ -n "${FAKE_OP_REQUIRE_NONINTERACTIVE:-}" ]]; then
    [[ "${OP_BIOMETRIC_UNLOCK_ENABLED:-}" == false ]] || exit 8
    if IFS= read -r ignored; then exit 9; fi
  fi
  [[ -n "${FAKE_OP_UNSIGNED:-}" && "${1:-}" != account && ( ! -f "${FAKE_OP_STATE:-}" || "${FAKE_OP_SIGNIN_FAILURE:-}" == still-unsigned ) ]] && { echo "not signed in ${FAKE_OP_CANARY:-}" >&2; exit 1; }
  case "${1:-} ${2:-}" in
    "account list")
      [[ -n "${FAKE_OP_ACCOUNTS:-}" ]] && { printf '%s\n' "$FAKE_OP_ACCOUNTS"; exit 0; }
      if [[ -n "${FAKE_OP_MANUAL:-}" ]]; then printf '%s\n' '[{"shorthand":"fixture"}]'
      else printf '%s\n' '[{"user_uuid":"fixture"}]'; fi ;;
    "whoami --format") printf '%s\n' '{"id":"synthetic-account"}' ;;
    "vault list")
      if [[ "${FAKE_OP_MISSING_VAULT:-}" == example-vault ]]; then printf '%s\n' '[]'
      else
        fake_vaults='[{"id":"synthetic-vault","name":"example-vault"}]'
        printf '%s\n' "${FAKE_OP_VAULTS:-$fake_vaults}"; fi ;;
    "item list")
      if [[ -n "${FAKE_OP_MISSING_ITEM:-}" ]]; then printf '%s\n' '[]'
      elif [[ -n "${FAKE_OP_ARCHIVED_ID:-}" && " $* " == *" --include-archive "* ]]; then
        printf '%s\n' '[{"id":"synthetic-item","title":"example-item"},{"id":"archived-item-id","title":"archived-title"}]'
      elif [[ -n "${FAKE_OP_ITEMS:-}" ]]; then printf '%s\n' "$FAKE_OP_ITEMS"
      else printf '[{"id":"synthetic-item","title":"example-item","fields":[{"value":"%s"}]}]\n' "${FAKE_OP_CANARY:-synthetic-value}"; fi ;;
    "item get")
      [[ -n "${FAKE_OP_FIELDS:-}" ]] && { printf '%s\n' "$FAKE_OP_FIELDS"; exit 0; }
      [[ -n "${FAKE_OP_GET_FAIL:-}" ]] && { echo "${FAKE_OP_CANARY:-}" >&2; exit 1; }
      [[ -n "${FAKE_OP_BAD_ITEM_JSON:-}" ]] && { printf '%s' "${FAKE_OP_CANARY:-}"; exit 0; }
      if [[ -n "${FAKE_OP_MISSING_FIELD:-}" ]]; then printf '{"fields":[],"value":"%s"}\n' "${FAKE_OP_CANARY:-}"
      else printf '{"fields":[{"id":"token","label":"token","value":"%s"},{"id":"api-key","label":"api-key"},{"id":"webhook-secret","label":"webhook-secret"},{"id":"field-id","label":"token","section":{"id":"section-id","label":"credentials"},"value":"%s"}]}\n' "${FAKE_OP_CANARY:-}" "${FAKE_OP_CANARY:-}"; fi ;;
    *) exit 3 ;;
  esac
  exit 0
fi
[[ "${1:-}" == run ]] || { echo "fake-op: only 'run' is supported" >&2; exit 3; }
shift
while [[ $# -gt 0 && "$1" != -- ]]; do shift; done
[[ "${1:-}" == -- ]] || { echo "fake-op: missing --" >&2; exit 3; }
shift
[[ -n "${FAKE_OP_BEFORE:-}" ]] && bash -c "$FAKE_OP_BEFORE"
[[ -n "${FAKE_OP_FAIL:-}" ]] && { echo "[ERROR] fake-op: could not resolve a reference ${FAKE_OP_CANARY:-}" >&2; exit 1; }
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
