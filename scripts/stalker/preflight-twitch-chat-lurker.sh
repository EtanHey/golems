#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-$SCRIPT_DIR/dist/twitch-chat-lurker.js}"
TIMEOUT_SECONDS="${STALKER_CHAT_PREFLIGHT_TIMEOUT:-5}"
TMPDIR_="$(mktemp -d)"
CHAT_OUTPUT="$TMPDIR_/chat.log"
LOG_FILE="$TMPDIR_/chat-lurker.log"
LURKER_PID=""

# Invoked through the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
    if [ -n "$LURKER_PID" ]; then
        kill "$LURKER_PID" 2>/dev/null || true
        wait "$LURKER_PID" 2>/dev/null || true
    fi
    rm -rf "$TMPDIR_"
}
trap cleanup EXIT

if [ ! -f "$TARGET" ]; then
    printf 'chat_lurker_preflight=FAIL reason=target_missing target=%s\n' "$TARGET" >&2
    exit 1
fi

STALKER_CHAT_PREFLIGHT=1 \
TWITCH_CHANNEL=__golems_preflight__ \
CHAT_OUTPUT="$CHAT_OUTPUT" \
    bun run --no-install "$TARGET" > "$LOG_FILE" 2>&1 &
LURKER_PID=$!

deadline=$((SECONDS + TIMEOUT_SECONDS))
while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$LURKER_PID" 2>/dev/null; then
        cat "$LOG_FILE" >&2
        printf 'chat_lurker_preflight=FAIL reason=process_exited target=%s\n' "$TARGET" >&2
        exit 1
    fi
    if [ -f "$CHAT_OUTPUT" ] && grep -F -q '[lurk] Connected to __golems_preflight__' "$LOG_FILE"; then
        printf 'chat_lurker_preflight=PASS target=%s output_open=true connected_sentinel=true\n' "$TARGET"
        exit 0
    fi
    sleep 0.1
done

cat "$LOG_FILE" >&2
printf 'chat_lurker_preflight=FAIL reason=timeout target=%s output_open=%s connected_sentinel=false\n' \
    "$TARGET" "$([ -f "$CHAT_OUTPUT" ] && printf true || printf false)" >&2
exit 1
