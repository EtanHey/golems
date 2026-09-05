#!/bin/bash
# Lazy enrichment — single worker, lowest priority, runs when Mac is on.
# launchd restarts us after each run (KeepAlive + ThrottleInterval).
#
# Stop:  enrichment stop   (or: launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.golems.enrichment.plist)
# Start: enrichment start  (or: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.golems.enrichment.plist)

BRAINLAYER_STATE_DIR="$HOME/.local/share/brainlayer"
LOG_DIR="$BRAINLAYER_STATE_DIR/logs"
DB_PATH="$BRAINLAYER_STATE_DIR/brainlayer.db"
LOCK_FILE="/tmp/brainlayer-enrichment.lock"
PYTHON313="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
BRAINLAYER_DIR="$HOME/Gits/brainlayer"

mkdir -p "$LOG_DIR"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" | tee -a "$LOG_DIR/enrichment.log"; }

# --- Lock check ---
if [ -f "$LOCK_FILE" ]; then
    OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null)
    if kill -0 "$OLD_PID" 2>/dev/null; then
        log "Already running (PID $OLD_PID). Exiting."
        exit 0  # exit 0 so launchd doesn't spam restarts
    fi
    rm -f "$LOCK_FILE"
fi

# --- DB check ---
if ! "$PYTHON313" -c "
import apsw
db = apsw.Connection('$DB_PATH', flags=apsw.SQLITE_OPEN_READONLY)
list(db.cursor().execute('SELECT COUNT(*) FROM chunks LIMIT 1'))
print('ok')
" 2>/dev/null | grep -q "ok"; then
    log "DB locked or inaccessible. Will retry next cycle."
    exit 0
fi

# --- Load env ---
cd "$BRAINLAYER_DIR" || exit 1
for ENV_FILE in "$HOME/Gits/golems/.env" "$HOME/Gits/golems/.env.local"; do
    [ -f "$ENV_FILE" ] && { set -a; source "$ENV_FILE"; set +a; }
done
export BRAINLAYER_ENRICH_BACKEND=mlx

# --- Wait for MLX (started by its own launchd plist) ---
MLX_BASE="${MLX_URL:-http://127.0.0.1:8080}"
MLX_BASE="${MLX_BASE%%/v1/*}"

for i in $(seq 1 90); do
    if curl -sf "${MLX_BASE}/v1/models" > /dev/null 2>&1; then
        break
    fi
    [ "$i" -eq 1 ] && log "Waiting for MLX server..."
    sleep 2
done

if ! curl -sf "${MLX_BASE}/v1/models" > /dev/null 2>&1; then
    log "MLX not available after 180s. Will retry next cycle."
    exit 0
fi

# --- Run enrichment (single worker, lowest CPU priority) ---
log "Starting lazy enrichment (parallel=1, batch=50, nice=20)"
echo $$ > "$LOCK_FILE"

nice -n 20 "$PYTHON313" -m brainlayer.pipeline.enrichment \
    --batch-size 50 --parallel=1 >> "$LOG_DIR/enrichment.log" 2>&1
EXIT_CODE=$?

rm -f "$LOCK_FILE"
log "Enrichment exited ($EXIT_CODE). launchd will restart in ~10min."
