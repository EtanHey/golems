#!/bin/bash
# Digest shell bridge. Sourced by the public entrypoint.

build_digest_body() {
    local stalker_root="$1"
    local digest_date="$2"
    STALKER_DIGEST_DATA_PATH="$SCRIPT_DIR/brain-delivery/digest-data.py" python3 - "$stalker_root" "$digest_date" < "$SCRIPT_DIR/brain-delivery/digest-render.py"
}

send_digest() {
    local stalker_root="$1"
    local digest_date="$2"
    local dry_run="$3"
    [ -d "$stalker_root" ] || { echo "digest: stalker root not found: $stalker_root" >&2; return 2; }

    local title body digest_status telegram_status
    stalker_reconcile_interrupted_scoring_root "$stalker_root"
    title="Stalker Morning Digest - ${digest_date}"
    if body="$(build_digest_body "$stalker_root" "$digest_date")"; then
        digest_status=0
    else
        digest_status=$?
        if [ "$body" != "no runs recorded for ${digest_date}" ]; then
            title="Stalker Morning Digest FAILED - ${digest_date}"
        fi
    fi

    if [ "$dry_run" = "1" ]; then
        printf '%s\n%s\n' "$title" "$body"
        return "$digest_status"
    fi

    telegram_status=0
    if notify_stalker_telegram "$title" "$body" "default" "stalker-golem"; then
        telegram_status=0
    else
        telegram_status=$?
    fi
    if [ "$telegram_status" -ne 0 ]; then
        return "$telegram_status"
    fi
    return "$digest_status"
}
