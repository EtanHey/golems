#!/usr/bin/env bash
# Auto-enrich — adaptive enrichment scheduling.
#
# Checks unenriched queue depth and runs enrichment if needed.
# Designed for cron/launchd: run every 6 hours or nightly.
#
# Usage:
#   ./scripts/auto-enrich.sh              # Run with defaults
#   ./scripts/auto-enrich.sh --threshold 200   # Only run if >200 unenriched
#   ./scripts/auto-enrich.sh --max-hours 2     # Cap at 2 hours
#
# Exit codes:
#   0 = enrichment ran or skipped (caught up)
#   1 = error (backend not running, DB locked, etc.)

set -euo pipefail

GOLEMS_DIR="${HOME}/Gits/golems"
BRAINLAYER_DIR="${HOME}/Gits/brainlayer"
DB_PATH="${HOME}/.local/share/zikaron/zikaron.db"
LOG_DIR="${HOME}/.golems-zikaron/logs"
LOG_FILE="${LOG_DIR}/auto-enrich.log"
NOTIFY="${HOME}/.local/bin/notify"

# Defaults
THRESHOLD=500
MAX_HOURS=3
PARALLEL=1

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --threshold) THRESHOLD="$2"; shift 2 ;;
    --max-hours) MAX_HOURS="$2"; shift 2 ;;
    --parallel)  PARALLEL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

MAX_CHUNKS=$((MAX_HOURS * 1500))  # ~1500 chunks/hr with parallel MLX

mkdir -p "$LOG_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" | tee -a "$LOG_FILE"; }

# Check venv exists
# Get queue depth
UNENRICHED=$(python3 -c "
import apsw
from pathlib import Path
db = apsw.Connection('${DB_PATH}', flags=apsw.SQLITE_OPEN_READONLY)
total = list(db.cursor().execute('SELECT COUNT(*) FROM chunks WHERE enriched_at IS NULL'))[0][0]
print(total)
db.close()
" 2>/dev/null) || { log "ERROR: Could not query DB"; exit 1; }

log "Queue depth: ${UNENRICHED} unenriched chunks (threshold: ${THRESHOLD})"

# Check if we need to run
if [ "$UNENRICHED" -lt "$THRESHOLD" ]; then
  log "Skipping — queue below threshold (${UNENRICHED} < ${THRESHOLD})"
  exit 0
fi

# Alert if queue is very large (>5000 = 3+ days behind)
if [ "$UNENRICHED" -gt 5000 ] && [ -x "$NOTIFY" ]; then
  DAYS_BEHIND=$(echo "scale=1; $UNENRICHED / 1500" | bc 2>/dev/null || echo "?")
  "$NOTIFY" "Enrichment Behind" "Queue: ${UNENRICHED} chunks (~${DAYS_BEHIND} days behind)" 2>/dev/null || true
fi

# Load env vars BEFORE backend check — backend selection may be configured in .env
for ENV_FILE in "$GOLEMS_DIR/.env" "$GOLEMS_DIR/.env.local"; do
  if [ -f "$ENV_FILE" ]; then
    set -a; source "$ENV_FILE"; set +a
  fi
done

# Check backend
BACKEND="${ZIKARON_ENRICH_BACKEND:-ollama}"
if [ "$BACKEND" = "mlx" ]; then
  MLX_URL="${MLX_URL:-http://127.0.0.1:8080}"
  if ! curl -sf "${MLX_URL}/v1/models" > /dev/null 2>&1; then
    log "ERROR: MLX server not running at ${MLX_URL}"
    exit 1
  fi
  log "Backend: MLX at ${MLX_URL}"
else
  if ! curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    log "Ollama not running, attempting to start..."
    open -a OllamaHelper 2>/dev/null || ollama serve &
    sleep 5
    if ! curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
      log "ERROR: Could not start Ollama"
      exit 1
    fi
  fi
  log "Backend: Ollama"
fi

# Run enrichment
log "Starting enrichment: max=${MAX_CHUNKS}, parallel=${PARALLEL}"
cd "$BRAINLAYER_DIR"

# Temporarily disable errexit so we can capture PIPESTATUS after pipeline
set +eo pipefail
PYTHONUNBUFFERED=1 python3 -m brainlayer.pipeline.enrichment \
  --batch-size=50 \
  --max="$MAX_CHUNKS" \
  --parallel="$PARALLEL" \
  2>&1 | tee -a "$LOG_FILE"
ENRICH_EXIT=${PIPESTATUS[0]}
set -eo pipefail
if [ "$ENRICH_EXIT" -ne 0 ]; then
  log "Enrichment exited with error (code: ${ENRICH_EXIT})"
fi

# Post-run stats
NEW_UNENRICHED=$(python3 -c "
import apsw
from pathlib import Path
db = apsw.Connection('${DB_PATH}', flags=apsw.SQLITE_OPEN_READONLY)
total = list(db.cursor().execute('SELECT COUNT(*) FROM chunks WHERE enriched_at IS NULL'))[0][0]
print(total)
db.close()
" 2>/dev/null) || true

PROCESSED=$((UNENRICHED - ${NEW_UNENRICHED:-$UNENRICHED}))
log "Done: processed ~${PROCESSED} chunks, queue now: ${NEW_UNENRICHED:-unknown}"

# Notify completion
if [ -x "$NOTIFY" ]; then
  "$NOTIFY" "Enrichment Done" "Processed ~${PROCESSED}, queue: ${NEW_UNENRICHED:-?}" 2>/dev/null || true
fi

exit "$ENRICH_EXIT"
