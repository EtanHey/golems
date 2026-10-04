#!/bin/bash
# Sourced by ../stream-helpers.sh; keep the public entry as the source path.

_stalker_json_payload() {
    local recipient="$1"
    local message="$2"
    command -v python3 >/dev/null 2>&1 || return 127
    python3 -c 'import json, sys; print(json.dumps({"recipient": sys.argv[1], "message": sys.argv[2]}))' "$recipient" "$message"
}

notify_stalker_whatsapp() {
    local message="$1"
    if [ "${STREAM_WHATSAPP_NOTIFY:-1}" = "0" ]; then
        echo "WhatsApp notifications disabled by STREAM_WHATSAPP_NOTIFY=0"
        return 0
    fi

    local queue_dir="${STALKER_WHATSAPP_QUEUE_DIR:-$HOME/.brainlayer/queue/stalker-whatsapp-pending}"
    local recipient="${STREAM_WHATSAPP_RECIPIENT:-${STALKER_WHATSAPP_RECIPIENT:-}}"
    if [ -z "$recipient" ]; then
        echo "WhatsApp notifications disabled: STREAM_WHATSAPP_RECIPIENT not set"
        return 0
    fi

    local payload
    payload=$(_stalker_json_payload "$recipient" "$message") || {
        echo "WhatsApp notifications disabled: python3 is required to build JSON payload" >&2
        return 1
    }

    local endpoints="${STALKER_WHATSAPP_ENDPOINTS:-http://127.0.0.1:8741/api/send http://127.0.0.1:8741/api/sendMessage http://127.0.0.1:8080/api/send http://127.0.0.1:8742/api/send}"
    local url
    for url in $endpoints; do
        if command -v curl >/dev/null 2>&1 && curl -fsS -m "${STALKER_WHATSAPP_TIMEOUT:-5}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$payload" \
            "$url" >/dev/null 2>&1; then
            printf 'WhatsApp sent via %s\n' "$url" >&2
            return 0
        fi
        printf 'WhatsApp send failed via %s\n' "$url" >&2
    done

    mkdir -p "$queue_dir"
    local queued_at queue_file
    queued_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    queue_file="$queue_dir/$(date -u '+%Y%m%dT%H%M%SZ')-$$-${RANDOM:-0}-stalker-whatsapp.json"
    python3 -c '
import json, sys
record = {"recipient": sys.argv[1], "message": sys.argv[2], "queued_at": sys.argv[3], "reason": "all WhatsApp bridge endpoints failed"}
open(sys.argv[4], "w").write(json.dumps(record, indent=2) + "\n")
' "$recipient" "$message" "$queued_at" "$queue_file"
    printf 'WhatsApp queued for retry: %s\n' "$queue_file" >&2
    return 1
}
