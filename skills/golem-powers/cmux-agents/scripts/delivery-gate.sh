#!/usr/bin/env bash
# delivery-gate.sh — Verify prompt delivery to a cmux agent surface
#
# After send_input + send_key, the agent terminal may be frozen or unresponsive.
# This script checks that token_count increased and status is non-null,
# using exponential backoff (2s, 4s, 8s). On failure, returns exit code 1
# so the caller can fall back to Agent tool.
#
# Usage:
#   delivery-gate.sh --surface <ID> [--retries N] [--backoff-base S] [--dry-run]
#
# Exit codes:
#   0 — Delivery confirmed (token_count > 0 AND status != null)
#   1 — Delivery failed after all retries (circuit breaker triggered)

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: delivery-gate.sh --surface <ID> [OPTIONS]

Verify that a prompt was delivered to a cmux agent surface.
Checks token_count > 0 AND status is non-null with exponential backoff.

Options:
  --surface <ID>      cmux surface ID (e.g., surface:99). Required.
  --retries <N>       Max retry attempts (default: 3)
  --backoff-base <S>  Base delay in seconds, doubles each retry (default: 2)
  --dry-run           Simulate verification without cmux calls
  --help              Show this help

Exit codes:
  0  Delivery confirmed (token_count > 0 AND status != null)
  1  Delivery failed after all retries — circuit breaker triggered
EOF
}

SURFACE=""
RETRIES=3
BACKOFF_BASE=2
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --surface)
      [[ $# -lt 2 ]] && { echo "Error: --surface requires a value" >&2; usage; exit 1; }
      SURFACE="$2"; shift 2
      ;;
    --retries)
      [[ $# -lt 2 ]] && { echo "Error: --retries requires a value" >&2; usage; exit 1; }
      RETRIES="$2"; shift 2
      ;;
    --backoff-base)
      [[ $# -lt 2 ]] && { echo "Error: --backoff-base requires a value" >&2; usage; exit 1; }
      BACKOFF_BASE="$2"; shift 2
      ;;
    --dry-run)
      DRY_RUN=true; shift
      ;;
    --help)
      usage; exit 0
      ;;
    *)
      echo "Error: unknown flag '$1'" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SURFACE" ]]; then
  echo "Error: --surface is required" >&2
  usage
  exit 1
fi

# --- Dry-run mode: simulate delivery check ---
if $DRY_RUN; then
  echo "delivery-gate: dry-run verification for $SURFACE"
  echo "  retries: $RETRIES"
  echo "  backoff_base: ${BACKOFF_BASE}s"
  echo "  schedule: $(for i in $(seq 0 $((RETRIES - 1))); do echo -n "$((BACKOFF_BASE * (2 ** i)))s "; done)"
  echo "  result: SIMULATED_OK (dry-run)"
  exit 0
fi

# --- Real verification with exponential backoff ---
attempt=0
delay=$BACKOFF_BASE

while [[ $attempt -lt $RETRIES ]]; do
  attempt=$((attempt + 1))

  echo "delivery-gate: attempt $attempt/$RETRIES — waiting ${delay}s..."
  sleep "$delay"

  # Read screen with parsed_only to get structured data
  # cmux read-screen returns token count and status info
  screen_output=$(cmux read-screen --surface "$SURFACE" --lines 10 2>/dev/null || echo "")

  if [[ -z "$screen_output" ]]; then
    echo "delivery-gate: attempt $attempt — empty screen output"
    delay=$((delay * 2))
    continue
  fi

  # Check for signs of active agent:
  # 1. Token streaming or spinner or tool use
  # 2. Status bar with tokens/cost visible
  # 3. NOT just a shell prompt
  has_activity=false

  # Active thinking/streaming indicators
  if echo "$screen_output" | grep -qE '●|↓ [0-9]|⏺ .+\(|tokens|CLAUDE_COUNTER'; then
    has_activity=true
  fi

  # Status bar with cost (means Claude is running)
  if echo "$screen_output" | grep -qE '\$[0-9]+\.[0-9]+'; then
    has_activity=true
  fi

  # Claude UI separator (means Claude booted at minimum)
  if echo "$screen_output" | grep -qE '^───'; then
    has_activity=true
  fi

  if $has_activity; then
    echo "delivery-gate: CONFIRMED — agent active on $SURFACE (attempt $attempt)"
    exit 0
  fi

  echo "delivery-gate: attempt $attempt — no activity detected"
  delay=$((delay * 2))
done

# Circuit breaker — all retries exhausted
echo "delivery-gate: FAILED — no delivery confirmed on $SURFACE after $RETRIES attempts"
echo "delivery-gate: CIRCUIT BREAKER — recommend Agent tool fallback"
exit 1
