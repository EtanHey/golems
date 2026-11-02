#!/usr/bin/env bash
# Prints the Google account research runs must be signed in as.
# Order: RESEARCH_ACCOUNT env, then the RESEARCH_ACCOUNT=<address> line in
# ~/.config/research-lifecycle/research.env (parsed, never sourced).
# Exits 2 naming that file when neither is set. There is no placeholder default.
set -euo pipefail

CONFIG_FILE="${HOME:?HOME is not set}/.config/research-lifecycle/research.env"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

account=$(trim "${RESEARCH_ACCOUNT:-}")

if [[ -z "$account" && -f "$CONFIG_FILE" ]]; then
  pattern='^(export[[:space:]]+)?RESEARCH_ACCOUNT[[:space:]]*=(.*)$'
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=$(trim "$line")
    [[ "$line" =~ $pattern ]] || continue
    value=$(trim "${BASH_REMATCH[2]}")
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    account=$(trim "$value")
  done <"$CONFIG_FILE"
fi

if [[ -z "$account" ]]; then
  echo "Research account not configured: set RESEARCH_ACCOUNT or add a RESEARCH_ACCOUNT=<address> line to $CONFIG_FILE" >&2
  exit 2
fi

printf '%s\n' "$account"
