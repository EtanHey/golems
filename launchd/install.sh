#!/bin/bash
# Install the golems launchd agents
#
# Usage: ./install.sh [--uninstall]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
NODE_BIN="$(command -v node)"

PLISTS=(
    "com.golems.worktree-gc.plist"
    "com.golems.agent-browser-reap.plist"
)
RETIRED=("com.golemszikaron.briefing.plist")

domain="gui/$(id -u)"

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
            exit 1
        fi
    fi
}

remove_plists() {
    local plist label
    for plist in "$@"; do
        label="${plist%.plist}"
        unload_label "$label"
        if [[ -f "$LAUNCH_AGENTS/$plist" ]]; then
            echo "  Removing $plist..."
            rm "$LAUNCH_AGENTS/$plist"
        fi
    done
}

if [[ "${1:-}" == "--uninstall" ]]; then
    echo "🗑️  Uninstalling golems launchd agents..."

    "$NODE_BIN" "$SCRIPT_DIR/../scripts/install-google-drive-oauth-guard.mjs" uninstall

    remove_plists "${RETIRED[@]}" "${PLISTS[@]}"

    echo "✅ Uninstalled!"
    exit 0
fi

echo "🚀 Installing golems launchd agents..."

# Ensure LaunchAgents directory exists
mkdir -p "$LAUNCH_AGENTS"

remove_plists "${RETIRED[@]}"

"$NODE_BIN" "$SCRIPT_DIR/../scripts/install-google-drive-oauth-guard.mjs" install

for plist in "${PLISTS[@]}"; do
    label="${plist%.plist}"

    # Remove the loaded definition so bootstrap picks up the rendered plist.
    unload_label "$label"

    # Render host-specific paths into the installed plist.
    echo "  Installing $plist..."
    "$SCRIPT_DIR/render-plist.sh" "$SCRIPT_DIR/$plist" "$LAUNCH_AGENTS/$plist"

    # Bootstrap failures must stop installation before the success message.
    echo "  Loading $label..."
    if ! launchctl bootstrap "$domain" "$LAUNCH_AGENTS/$plist"; then
        echo "ERROR: Failed to bootstrap $label in $domain" >&2
        exit 1
    fi
done

echo ""
echo "✅ Installed! Schedules:"
echo "  - Worktree prune (scripts/worktree-gc-nightly.sh, under the heavy-suite lock): 6:00 AM daily"
echo "  - Agent browser: reap expired leases every 10 minutes"
echo "  - Google Drive OAuth guard: login + every 5 minutes"
echo ""
echo "📋 Commands:"
echo "  View logs: tail -f /tmp/golemszikaron-*.log"
echo "  Uninstall: $0 --uninstall"
