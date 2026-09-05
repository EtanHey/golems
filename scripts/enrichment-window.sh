#!/bin/bash
# Brainlayer enrichment — runs for a fixed window then stops cleanly.
# Usage: enrichment-window.sh [hours]
# Default: 12 hours
#
# Safety: checks DB isn't locked on start, kills cleanly on stop,
# verifies DB is unlocked after stop.

HOURS=${1:-12}
SECONDS_TO_RUN=$((HOURS * 3600))
BRAINLAYER_STATE_DIR="$HOME/.local/share/brainlayer"
LOG_DIR="$BRAINLAYER_STATE_DIR/logs"
DB_PATH="$BRAINLAYER_STATE_DIR/brainlayer.db"
LOCK_FILE="/tmp/brainlayer-enrichment.lock"
# AIDEV-NOTE: Must use explicit Python 3.13 — launchd may resolve python3 to 3.14
PYTHON313="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
BRAINLAYER_DIR="$HOME/Gits/brainlayer"

mkdir -p "$LOG_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" | tee -a "$LOG_DIR/enrichment.log"; }

# --- Pre-flight: check for stale lock / running process ---
if [ -f "$LOCK_FILE" ]; then
    OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null)
    if kill -0 "$OLD_PID" 2>/dev/null; then
        log "ERROR: Enrichment already running (PID $OLD_PID). Exiting."
        exit 1
    else
        log "WARN: Stale lock found (PID $OLD_PID dead). Removing."
        rm -f "$LOCK_FILE"
    fi
fi

# Check DB isn't locked by something else
if ! "$PYTHON313" -c "
import apsw
db = apsw.Connection('$DB_PATH', flags=apsw.SQLITE_OPEN_READONLY)
list(db.cursor().execute('SELECT COUNT(*) FROM chunks LIMIT 1'))
print('ok')
" 2>/dev/null | grep -q "ok"; then
    log "ERROR: DB appears locked or inaccessible. Exiting."
    exit 1
fi

log "Starting enrichment for ${HOURS}h (${SECONDS_TO_RUN}s)"

# --- Run enrichment ---
cd "$BRAINLAYER_DIR" || exit 1

# Load env vars (Supabase for logging, backend config)
for ENV_FILE in "$HOME/Gits/golems/.env" "$HOME/Gits/golems/.env.local"; do
    if [ -f "$ENV_FILE" ]; then
        set -a
        source "$ENV_FILE"
        set +a
    fi
done

# MLX-only backend (Apple Silicon optimized, 21-87% faster than Ollama)
# AIDEV-NOTE: No Ollama fallback — if MLX is down, enrichment should NOT run.
# Running on Ollama silently is wasteful and confusing. Fix MLX instead.
export BRAINLAYER_ENRICH_BACKEND=mlx

MLX_BASE="${MLX_URL:-http://127.0.0.1:8080}"
MLX_BASE="${MLX_BASE%%/v1/*}"
MLX_STARTED_BY_US=false
if ! curl -sf "${MLX_BASE}/v1/models" > /dev/null 2>&1; then
    log "MLX server not running. Starting mlx_lm.server..."
    nohup mlx_lm.server --model mlx-community/Qwen2.5-Coder-14B-Instruct-4bit --port 8080 > "$LOG_DIR/mlx-server.log" 2>&1 &
    MLX_PID=$!
    MLX_STARTED_BY_US=true
    # Wait up to 60s for MLX to be ready
    for i in $(seq 1 60); do
        if curl -sf "${MLX_BASE}/v1/models" > /dev/null 2>&1; then
            log "MLX server ready after ${i}s"
            break
        fi
        sleep 1
    done
    if ! curl -sf "${MLX_BASE}/v1/models" > /dev/null 2>&1; then
        log "ERROR: MLX server failed to start after 60s. Exiting."
        kill "$MLX_PID" 2>/dev/null
        exit 1
    fi
else
    log "MLX server OK at ${MLX_BASE}"
fi

# Reuse PYTHON313 defined at top of script
PYTHONUNBUFFERED=1 "$PYTHON313" -m brainlayer.pipeline.enrichment --batch-size 50 --parallel=3 >> "$LOG_DIR/enrichment.log" 2>&1 &
PID=$!
echo "$PID" > "$LOCK_FILE"

log "Enrichment PID: $PID"

# --- Clean shutdown handler ---
cleanup() {
    log "Stopping enrichment (PID $PID)..."
    kill "$PID" 2>/dev/null
    # Give it 10s to finish current chunk gracefully
    for i in $(seq 1 10); do
        kill -0 "$PID" 2>/dev/null || break
        sleep 1
    done
    # Force kill if still alive
    kill -9 "$PID" 2>/dev/null
    rm -f "$LOCK_FILE"

    # Verify DB is accessible
    if "$PYTHON313" -c "
import apsw
db = apsw.Connection('$DB_PATH', flags=apsw.SQLITE_OPEN_READONLY)
list(db.cursor().execute('SELECT COUNT(*) FROM chunks LIMIT 1'))
print('ok')
" 2>/dev/null | grep -q "ok"; then
        log "DB verified OK after shutdown."
    else
        log "WARN: DB may be locked after shutdown. Check manually."
    fi

    # Kill MLX if we started it
    if [ "$MLX_STARTED_BY_US" = true ] && [ -n "$MLX_PID" ]; then
        log "Stopping MLX server (PID $MLX_PID)..."
        kill "$MLX_PID" 2>/dev/null
        sleep 2
        kill -9 "$MLX_PID" 2>/dev/null
    fi

    log "Enrichment window closed."
    exit 0
}

trap cleanup SIGTERM SIGINT SIGHUP

# --- Wait for window to expire ---
sleep "$SECONDS_TO_RUN" &
SLEEP_PID=$!
wait "$SLEEP_PID" 2>/dev/null

cleanup
