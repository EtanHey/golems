# Shared launchd departure barrier. Caller supplies domain.
unload_label() {
    local label="$1"
    local attempt
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
        echo "  Unloading existing $label..."
        launchctl bootout "$domain/$label" 2>/dev/null || true
        # bootout can return before launchd finishes removing the service.
        for ((attempt = 0; attempt < 25; attempt++)); do
            if ! launchctl print "$domain/$label" >/dev/null 2>&1; then
                break
            fi
            sleep 0.2
        done
        if launchctl print "$domain/$label" >/dev/null 2>&1; then
            echo "ERROR: $label still loaded after bootout" >&2
            return 1
        fi
    fi
}
