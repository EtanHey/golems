#!/usr/bin/env bash
set -euo pipefail
die() { printf 'context-occupancy: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 1 ]] || die "usage: context-occupancy.sh <session.jsonl>"
rows=$(jq -sc '.' "$1") || die "cannot parse $1"
codex=$(jq -c '[.[] | select(.payload.type == "token_count")] | last' <<< "$rows")
if [[ "$codex" != null ]]; then
  occupancy=$(jq -er '.payload.info.last_token_usage.total_tokens' <<< "$codex") || die "last_token_usage.total_tokens is missing; refusing cumulative total_token_usage"
  window=$(jq -er '.payload.info.model_context_window' <<< "$codex") || die "model context window is missing or invalid"
else
  claude=$(jq -c '[.[] | select(.type == "assistant" and .message.usage)] | last' <<< "$rows")
  [[ "$claude" != null ]] || die "no Codex token_count or Claude assistant usage event found"
  model=$(jq -r '.message.model // empty' <<< "$claude")
  occupancy=$(jq '[.message.usage | .input_tokens, .cache_read_input_tokens, .cache_creation_input_tokens, .output_tokens] | add' <<< "$claude")
  case "$model" in
    claude-opus-4-[678]*|claude-sonnet-4-6*) window=1000000 ;;
    claude-haiku-4-5*|claude-sonnet-4-[0-5]*|claude-opus-4-[0-5]*) window=200000 ;;
    *) die "unknown Claude context window for model ${model:-<missing>}" ;;
  esac
fi
awk -v used="$occupancy" -v max="$window" 'BEGIN { if (max <= 0) exit 1; printf "%d/%d %.1f%%\n", used, max, used / max * 100 }' || die "model context window is missing or invalid"
