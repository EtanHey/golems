#!/bin/bash
# Set iTerm2 background image via AppleScript
# Usage: set-iterm-bg.sh /path/to/image.png
[[ -f "$1" ]] && osascript -e "tell application \"iTerm2\" to tell current session of current window to set background image to \"$1\"" 2>/dev/null
