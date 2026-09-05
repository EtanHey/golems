#!/usr/bin/env bash
# ram-gate.sh — decide local-vs-cloud for the AI video stage.
# Usage: ram-gate.sh [model_gb]   (default 19.4 for LTX-2.3 Q4)
# Exit 0 + "LOCAL_OK" if there's comfortable headroom; exit 1 + "USE_CLOUD" otherwise.
set -uo pipefail
MODEL_GB="${1:-19.4}"
FACTOR=1.4   # need free+inactive >= model * FACTOR to avoid swap/compression pressure

FREE_INACT_GB=$(vm_stat | awk '
  /Pages free/{f=$3} /Pages inactive/{i=$3}
  END{gsub(/\./,"",f); gsub(/\./,"",i); printf "%.1f", (f+i)*16384/1e9}')
FREE_PCT=$(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/{gsub(/%/,"",$2); print $2}')

NEED=$(awk -v m="$MODEL_GB" -v fac="$FACTOR" 'BEGIN{printf "%.1f", m*fac}')
echo "model=${MODEL_GB}GB need>=${NEED}GB free+inactive=${FREE_INACT_GB}GB free%=${FREE_PCT:-?}"

if awk -v a="$FREE_INACT_GB" -v b="$NEED" 'BEGIN{exit !(a>=b)}'; then
  echo "LOCAL_OK"
  exit 0
else
  echo "USE_CLOUD — insufficient headroom; route AI video to Replicate/fal so we don't OOM the fleet"
  exit 1
fi
