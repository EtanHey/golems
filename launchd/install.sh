#!/bin/bash
# Install GolemsZikaron launchd agents
#
# Usage: ./install.sh [--uninstall]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
NODE_BIN="$(command -v node)"

PLISTS=(
    "com.golemszikaron.ollama.plist"
    "com.golemszikaron.nightshift.plist"
    "com.golemszikaron.briefing.plist"
)

if [[ "${1:-}" == "--uninstall" ]]; then
    echo "🗑️  Uninstalling GolemsZikaron launchd agents..."

    "$NODE_BIN" "$SCRIPT_DIR/../scripts/install-google-drive-oauth-guard.mjs" uninstall

    for plist in "${PLISTS[@]}"; do
        label="${plist%.plist}"
        if launchctl list | grep -q "$label"; then
            echo "  Unloading $label..."
            launchctl unload "$LAUNCH_AGENTS/$plist" 2>/dev/null || true
        fi
        if [[ -f "$LAUNCH_AGENTS/$plist" ]]; then
            echo "  Removing $plist..."
            rm "$LAUNCH_AGENTS/$plist"
        fi
    done

    echo "✅ Uninstalled!"
    exit 0
fi

echo "🚀 Installing GolemsZikaron launchd agents..."

# Ensure LaunchAgents directory exists
mkdir -p "$LAUNCH_AGENTS"

"$NODE_BIN" "$SCRIPT_DIR/../scripts/install-google-drive-oauth-guard.mjs" install

for plist in "${PLISTS[@]}"; do
    label="${plist%.plist}"

    # Unload if already loaded
    if launchctl list | grep -q "$label"; then
        echo "  Unloading existing $label..."
        launchctl unload "$LAUNCH_AGENTS/$plist" 2>/dev/null || true
    fi

    # Render host-specific paths into the installed plist.
    echo "  Installing $plist..."
    "$SCRIPT_DIR/render-plist.sh" "$SCRIPT_DIR/$plist" "$LAUNCH_AGENTS/$plist"

    # Load
    echo "  Loading $label..."
    launchctl load "$LAUNCH_AGENTS/$plist"
done

echo ""
echo "✅ Installed! Schedules:"
echo "  - Ollama: Always running (KeepAlive)"
echo "  - Night Shift: 3:00 AM daily"
echo "  - Briefing: 8:00 AM daily"
echo "  - Google Drive OAuth guard: login + every 5 minutes"
echo ""
echo "📋 Commands:"
echo "  View logs: tail -f /tmp/golemszikaron-*.log"
echo "  Test night shift: bun ~/Gits/golems-zikaron/src/night-shift.ts"
echo "  Test briefing: bun ~/Gits/golems-zikaron/src/briefing.ts"
echo "  Uninstall: $0 --uninstall"
