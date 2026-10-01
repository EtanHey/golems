#!/bin/bash
# Sourced by the public stalker-brainlayer.sh entry.

ingest_run() {
    local stream_dir="$1"
    local dry_run="$2"
    [ -d "$stream_dir" ] || { echo "ingest-run: stream directory not found: $stream_dir" >&2; return 2; }

    local payloads_file pending_file replay_file state_file total_count stored_count queued_count payload status record_key batch_status
    payloads_file="$(mktemp)"
    pending_file="$(mktemp)"
    replay_file="$stream_dir/orphaned_stores.jsonl"
    state_file="$stream_dir/.brainlayer-store-state.jsonl"
    build_brain_payloads "$stream_dir" > "$payloads_file"
    total_count=$(wc -l < "$payloads_file" | tr -d ' ')
    stored_count=0
    queued_count=0

    if [ "$dry_run" = "1" ]; then
        cat "$payloads_file"
        rm -f "$payloads_file" "$pending_file"
        return 0
    fi

    while IFS= read -r payload; do
        [ -n "$payload" ] || continue
        record_key="$(payload_record_key "$payload")"
        if store_state_has "$state_file" "$record_key" "stored"; then
            stored_count=$((stored_count + 1))
            continue
        fi
        printf '%s\n' "$payload" >> "$pending_file"
    done < "$payloads_file"

    batch_status=0
    if [ -s "$pending_file" ]; then
        store_payloads "$pending_file" "$state_file" || batch_status=$?
    fi

    while IFS= read -r payload; do
        [ -n "$payload" ] || continue
        record_key="$(payload_record_key "$payload")"
        if store_state_has "$state_file" "$record_key" "stored"; then
            stored_count=$((stored_count + 1))
        else
            if ! store_state_has "$state_file" "$record_key" "queued"; then
                queue_payload "$replay_file" "brain_store_failed" "$payload"
                append_store_state "$state_file" "$record_key" "queued"
            fi
            queued_count=$((queued_count + 1))
        fi
    done < "$pending_file"

    rm -f "$payloads_file" "$pending_file"

    if [ "$batch_status" -ne 0 ]; then
        printf 'BrainLayer batch process exited with status %s; unfinished payloads were queued\n' "$batch_status" >&2
    fi

    if [ "$queued_count" -gt 0 ] || [ "$((stored_count + queued_count))" -ne "$total_count" ]; then
        status="queued"
    else
        status="stored"
    fi
    write_brainlayer_status "$stream_dir" "$status" "$stored_count" "$queued_count" "$total_count" "$replay_file"
    if [ "$queued_count" -eq 0 ] && [ "$((stored_count + queued_count))" -eq "$total_count" ]; then
        mark_stalker_stage_done "$stream_dir" "brainlayer"
    fi
}

queue_unfinished_run() {
    local stream_dir="$1"
    local reason="$2"
    [ -d "$stream_dir" ] || { echo "queue-run: stream directory not found: $stream_dir" >&2; return 2; }

    local payloads_file replay_file state_file total_count stored_count queued_count payload record_key status
    payloads_file="$(mktemp)"
    replay_file="$stream_dir/orphaned_stores.jsonl"
    state_file="$stream_dir/.brainlayer-store-state.jsonl"
    build_brain_payloads "$stream_dir" > "$payloads_file"
    total_count=$(wc -l < "$payloads_file" | tr -d ' ')
    stored_count=0
    queued_count=0

    while IFS= read -r payload; do
        [ -n "$payload" ] || continue
        record_key="$(payload_record_key "$payload")"
        if store_state_has "$state_file" "$record_key" "stored"; then
            stored_count=$((stored_count + 1))
            continue
        fi
        if ! store_state_has "$state_file" "$record_key" "queued"; then
            queue_payload "$replay_file" "$reason" "$payload"
            append_store_state "$state_file" "$record_key" "queued"
        fi
        queued_count=$((queued_count + 1))
    done < "$payloads_file"

    rm -f "$payloads_file"
    if [ "$queued_count" -eq 0 ] && [ "$((stored_count + queued_count))" -eq "$total_count" ]; then
        status="stored"
        mark_stalker_stage_done "$stream_dir" "brainlayer"
    else
        status="queued"
    fi
    write_brainlayer_status "$stream_dir" "$status" "$stored_count" "$queued_count" "$total_count" "$replay_file"
}
