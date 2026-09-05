#!/usr/bin/env bash
set -euo pipefail

LIVE_GUARD_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stream-helpers.sh
source "$LIVE_GUARD_SCRIPT_DIR/lib/stream-helpers.sh"

CHANNEL="${1:-theo}"
QUALITY="${2:-best}"

if [[ ! "$CHANNEL" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo "ERROR: invalid channel '$CHANNEL'" >&2
  exit 1
fi

ROOT="${HOME}/Gits/golems"
SCRIPT="${ROOT}/scripts/stream-watcher.sh"
LOG_DIR="${ROOT}/docs.local/stalker-golem"
PLIST="${HOME}/Library/LaunchAgents/com.golems.stream-watcher.plist"
LABEL="com.golems.stream-watcher"
SERVICE="gui/$(id -u)/${LABEL}"

CHECK_INTERVAL="${CHECK_INTERVAL:-60}"
STALL_SECONDS="${STALL_SECONDS:-180}"
ACTIVE_RECORDING_FRESHNESS_SECONDS="${ACTIVE_RECORDING_FRESHNESS_SECONDS:-$STALL_SECONDS}"
LIVE_RECORDING_GRACE="${LIVE_RECORDING_GRACE:-420}"
RESTART_COOLDOWN="${RESTART_COOLDOWN:-120}"

LOG_FILE="${LOG_DIR}/live-guard-$(date +%Y-%m-%d).log"
PID_FILE="${LOG_DIR}/live-guard.pid"

mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    echo "live guard already running as PID $old_pid"
    exit 0
  fi
fi

echo "$$" > "$PID_FILE"

cleanup() {
  rm -f "$PID_FILE"
}

trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

log() {
  printf '[live-guard %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

notify() {
  local title="$1"
  local body="$2"
  curl -fsS -X POST http://localhost:3847/notify \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg title "$title" --arg body "$body" '{title:$title, body:$body, priority:"default"}')" \
    >/dev/null 2>&1 || true
}

watcher_pids() {
  pgrep -f "stream-watcher.sh ${CHANNEL} ${QUALITY}" || true
}

recorder_pids() {
  {
    pgrep -f "yt-dlp.*${CHANNEL}" || true
    pgrep -f "ffmpeg.*stalker-golem/${CHANNEL}-" || true
    pgrep -f "twitch-lurk-${CHANNEL}" || true
  } | awk 'NF' | sort -n | uniq
}

latest_stream_dir() {
  stalker_latest_stamped_stream_dir "$LOG_DIR" "$CHANNEL"
}

latest_video_file() {
  local dir="$1"
  [ -n "$dir" ] || return 0
  if [ -f "$dir/video.ts" ]; then
    printf '%s\n' "$dir/video.ts"
  elif [ -f "$dir/video.mp4" ]; then
    printf '%s\n' "$dir/video.mp4"
  fi
  return 0
}

check_live() {
  LIVE_URL=""
  LIVE_PLATFORM=""

  local twitch_url="https://www.twitch.tv/${CHANNEL}"
  local youtube_url="https://www.youtube.com/@${CHANNEL}/live"

  if yt-dlp --simulate --no-download --quiet --no-warnings \
    --socket-timeout 20 --retries 1 "$twitch_url" >/dev/null 2>&1; then
    LIVE_URL="$twitch_url"
    LIVE_PLATFORM="twitch"
    return 0
  fi

  if yt-dlp --simulate --no-download --quiet --no-warnings \
    --socket-timeout 20 --retries 1 "$youtube_url" >/dev/null 2>&1; then
    LIVE_URL="$youtube_url"
    LIVE_PLATFORM="youtube"
    return 0
  fi

  return 1
}

write_diagnostics() {
  local reason="$1"
  local diag
  diag="${LOG_DIR}/live-guard-diagnostics-$(date +%Y%m%d-%H%M%S).log"
  {
    printf 'reason=%s\n' "$reason"
    date
    printf '\n--- launchctl ---\n'
    launchctl print "$SERVICE" 2>&1 || true
    printf '\n--- matching processes ---\n'
    pids="$(pgrep -f 'stream-watcher|yt-dlp|ffmpeg|twitch-lurk|process-stream' | tr '\n' ' ' || true)"
    if [ -n "$pids" ]; then
      pid_csv="$(printf '%s' "$pids" | xargs | tr ' ' ',')"
      ps -p "$pid_csv" -o pid,ppid,etime,stat,command 2>&1 || true
    fi
    printf '\n--- watcher.log tail ---\n'
    tail -n 80 "${LOG_DIR}/watcher.log" 2>&1 || true
    printf '\n--- watcher-error.log tail ---\n'
    tail -n 80 "${LOG_DIR}/watcher-error.log" 2>&1 || true
  } > "$diag"
  log "diagnostics written: $diag"
}

ensure_launchd_loaded() {
  if launchctl print "$SERVICE" >/dev/null 2>&1; then
    return 0
  fi

  log "launchd service missing; bootstrapping $PLIST"
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>>"$LOG_FILE" || true
  launchctl enable "$SERVICE" 2>>"$LOG_FILE" || true
}

restart_watcher() {
  local reason="$1"
  local now
  now="$(date +%s)"

  if [ $((now - LAST_RESTART_EPOCH)) -lt "$RESTART_COOLDOWN" ]; then
    log "restart suppressed by cooldown: $reason"
    return 0
  fi
  LAST_RESTART_EPOCH="$now"

  log "RESTART: $reason"
  write_diagnostics "$reason"
  notify "Stalker watcher restart" "$reason"

  ensure_launchd_loaded
  launchctl kickstart -k "$SERVICE" 2>>"$LOG_FILE" || launchctl start "$LABEL" 2>>"$LOG_FILE" || true
  sleep 15

  if [ -n "$(watcher_pids)" ]; then
    log "launchd restart verified: watcher pids $(watcher_pids | tr '\n' ' ')"
    return 0
  fi

  log "launchd restart did not produce watcher; starting direct nohup fallback"
  nohup bash "$SCRIPT" "$CHANNEL" "$QUALITY" >> "${LOG_DIR}/watcher-direct-fallback.log" 2>&1 &
  disown || true
  sleep 10

  if [ -n "$(watcher_pids)" ]; then
    log "direct fallback verified: watcher pids $(watcher_pids | tr '\n' ' ')"
    return 0
  fi

  log "ERROR: watcher still absent after launchd and direct fallback"
  notify "Stalker watcher failed" "Watcher absent after restart attempts; see $LOG_FILE"
}

LAST_RESTART_EPOCH=0
LAST_VIDEO_PATH=""
LAST_VIDEO_SIZE=0
LAST_VIDEO_CHANGE_EPOCH="$(date +%s)"
LIVE_WITHOUT_RECORDING_SINCE=0
CYCLE=0

log "=== live guard start: channel=${CHANNEL} quality=${QUALITY} interval=${CHECK_INTERVAL}s ==="
log "log: $LOG_FILE"

while true; do
  CYCLE=$((CYCLE + 1))
  now="$(date +%s)"

  live=false
  if check_live; then
    live=true
  fi

  watcher="$(watcher_pids | tr '\n' ' ')"
  recorder="$(recorder_pids | tr '\n' ' ')"
  dir="$(latest_stream_dir)"
  video="$(latest_video_file "$dir")"
  size=0
  video_mtime=0
  video_age=0
  video_is_stale=false
  if [ -n "$video" ]; then
    size="$(stat -f '%z' "$video" 2>/dev/null || echo 0)"
    video_mtime="$(stat -f '%m' "$video" 2>/dev/null || echo 0)"
    if [[ "$video_mtime" =~ ^[0-9]+$ ]] && [ "$video_mtime" -gt 0 ]; then
      video_age=$((now - video_mtime))
    fi
    if [ -z "$recorder" ] && [ "$video_age" -gt "$ACTIVE_RECORDING_FRESHNESS_SECONDS" ]; then
      video_is_stale=true
    fi
  fi

  if [ "$video_is_stale" = true ]; then
    LAST_VIDEO_PATH=""
    LAST_VIDEO_SIZE=0
    LAST_VIDEO_CHANGE_EPOCH="$now"
  elif [ "$video" != "$LAST_VIDEO_PATH" ]; then
    LAST_VIDEO_PATH="$video"
    LAST_VIDEO_SIZE="$size"
    LAST_VIDEO_CHANGE_EPOCH="$now"
  elif [ "$size" -gt "$LAST_VIDEO_SIZE" ]; then
    LAST_VIDEO_SIZE="$size"
    LAST_VIDEO_CHANGE_EPOCH="$now"
  fi

  if [ "$video_is_stale" = true ]; then
    log "cycle=${CYCLE} live=${live}${LIVE_PLATFORM:+/$LIVE_PLATFORM} url=${LIVE_URL:-none} watcher=${watcher:-none} recorder=${recorder:-none} video=${video:-none} size=${size} stale_video_age=${video_age}s"
  else
    log "cycle=${CYCLE} live=${live}${LIVE_PLATFORM:+/$LIVE_PLATFORM} url=${LIVE_URL:-none} watcher=${watcher:-none} recorder=${recorder:-none} video=${video:-none} size=${size}"
  fi

  if [ -z "$watcher" ]; then
    if [ "$live" = true ]; then
      restart_watcher "stream-watcher missing while ${CHANNEL} is live on ${LIVE_PLATFORM}"
    else
      log "watcher missing but ${CHANNEL} is offline; not restarting until live check says live"
    fi
    sleep "$CHECK_INTERVAL"
    continue
  fi

  if [ "$live" = true ]; then
    if [ -z "$recorder" ]; then
      if [ "$video_is_stale" = true ]; then
        log "${CHANNEL} live but latest recording candidate is stale (${video_age}s old > ${ACTIVE_RECORDING_FRESHNESS_SECONDS}s); waiting for a current recorder: $video"
      fi
      if [ "$LIVE_WITHOUT_RECORDING_SINCE" -eq 0 ]; then
        LIVE_WITHOUT_RECORDING_SINCE="$now"
        log "${CHANNEL} live but no recorder pids yet; starting grace timer"
      elif [ $((now - LIVE_WITHOUT_RECORDING_SINCE)) -ge "$LIVE_RECORDING_GRACE" ]; then
        restart_reason="${CHANNEL} still live for $((now - LIVE_WITHOUT_RECORDING_SINCE))s but no recorder pids"
        if [ "$video_is_stale" = true ]; then
          restart_reason="${restart_reason}; latest recording candidate is stale (${video_age}s old): $video"
        fi
        restart_watcher "$restart_reason"
        LIVE_WITHOUT_RECORDING_SINCE=0
      fi
    else
      LIVE_WITHOUT_RECORDING_SINCE=0
    fi

    if [ -n "$recorder" ] && [ -n "$video" ] && [ "$size" -gt 1000000 ] && [ $((now - LAST_VIDEO_CHANGE_EPOCH)) -ge "$STALL_SECONDS" ]; then
      restart_watcher "${CHANNEL} still live but video has not grown for $((now - LAST_VIDEO_CHANGE_EPOCH))s: $video"
      LAST_VIDEO_CHANGE_EPOCH="$now"
    fi
  else
    LIVE_WITHOUT_RECORDING_SINCE=0
  fi

  sleep "$CHECK_INTERVAL"
done
