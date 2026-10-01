#!/bin/bash
# Sourced by ../stream-helpers.sh; keep the public entry as the source path.

_stalker_sleep_between_retries() {
    local attempt="$1"
    local base="${STALKER_RETRY_SLEEP_BASE:-1}"
    [ "$base" = "0" ] && return 0
    sleep $((base * (2 ** (attempt - 1))))
}

transcribe_with_whisper_cli() {
    local segment_file="$1"
    local model_file="$2"
    local max_attempts="${3:-3}"

    command -v whisper-cli >/dev/null 2>&1 || return 127
    [ -f "$model_file" ] || return 126

    local attempt output status
    for ((attempt=1; attempt<=max_attempts; attempt++)); do
        output=$(whisper-cli -m "$model_file" -f "$segment_file" --no-timestamps 2>&1)
        status=$?
        if [ "$status" -eq 0 ]; then
            if [[ "$output" == \{* ]] && command -v python3 >/dev/null 2>&1; then
                python3 -c 'import json, sys; d=json.load(sys.stdin); print(d.get("text") or d.get("transcription") or d.get("result") or json.dumps(d))' <<< "$output"
            else
                printf '%s\n' "$output"
            fi
            return 0
        fi
        printf 'whisper-cli attempt %s/%s failed for %s: %s\n' "$attempt" "$max_attempts" "$segment_file" "$output" >&2
        [ "$attempt" -lt "$max_attempts" ] && _stalker_sleep_between_retries "$attempt"
    done

    return 1
}

transcribe_with_whisper_server() {
    local segment_file="$1"
    local max_attempts="${2:-3}"
    local endpoint="${WHISPER_SERVER_URL:-http://127.0.0.1:8178/inference}"

    command -v curl >/dev/null 2>&1 || return 127

    local attempt output status
    for ((attempt=1; attempt<=max_attempts; attempt++)); do
        output=$(curl -fsS -m "${WHISPER_SERVER_TIMEOUT:-30}" \
            -X POST \
            -F "file=@${segment_file}" \
            "$endpoint" 2>&1)
        status=$?
        if [ "$status" -eq 0 ]; then
            if [[ "$output" == \{* ]] && command -v python3 >/dev/null 2>&1; then
                python3 -c 'import json, sys; d=json.load(sys.stdin); print(d.get("text") or d.get("transcription") or d.get("result") or json.dumps(d))' <<< "$output"
            else
                printf '%s\n' "$output"
            fi
            return 0
        fi
        printf 'whisper-server attempt %s/%s failed for %s: %s\n' "$attempt" "$max_attempts" "$segment_file" "$output" >&2
        [ "$attempt" -lt "$max_attempts" ] && _stalker_sleep_between_retries "$attempt"
    done

    return 1
}

transcribe_segment_with_fallback() {
    local segment_file="$1"
    local model_file="$2"
    local segment_id="$3"
    local out_dir="$4"
    local max_attempts="${STALKER_TRANSCRIBE_ATTEMPTS:-3}"

    local output
    if output=$(transcribe_with_whisper_server "$segment_file" "$max_attempts"); then
        printf '%s\n' "$output"
        return 0
    fi

    if output=$(transcribe_with_whisper_cli "$segment_file" "$model_file" "$max_attempts"); then
        printf '%s\n' "$output"
        return 0
    fi

    local message="Stalker: segment ${segment_id} transcription failed permanently after ${max_attempts} retries, audio at ${segment_file}"
    mkdir -p "$out_dir"
    printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$message" >> "$out_dir/transcription-failures.log"
    return 1
}
