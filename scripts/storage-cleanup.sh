#!/bin/bash
# Storage Cleanup Script - runs weekly via launchd
# Cleans recurring storage hogs that creep up over time

set -euo pipefail

LOG_FILE="$HOME/.golems-zikaron/storage-cleanup.log"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

log "=== Storage cleanup started ==="
BEFORE=$(df -k / | awk 'NR==2{print $4}')

# 1. Wispr Flow backups - keep only last 2 days
WISPR_BACKUPS="$HOME/Library/Application Support/Wispr Flow/backups"
if [ -d "$WISPR_BACKUPS" ]; then
  count=$(find "$WISPR_BACKUPS" -name "*.sqlite" -mtime +2 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    find "$WISPR_BACKUPS" -name "*.sqlite" -mtime +2 -delete 2>/dev/null
    log "Deleted $count old Wispr Flow backups"
  fi
fi

# 2. Xcode DerivedData older than 7 days
DERIVED="$HOME/Library/Developer/Xcode/DerivedData"
if [ -d "$DERIVED" ]; then
  find "$DERIVED" -maxdepth 1 -mindepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null
  log "Cleaned old DerivedData"
fi

# 3. Unavailable simulator devices
xcrun simctl delete unavailable 2>/dev/null && log "Deleted unavailable simulators"

# 4. Old Cursor extension versions (keep only latest)
CURSOR_EXT="$HOME/.cursor/extensions"
if [ -d "$CURSOR_EXT" ]; then
  # Find claude-code extensions, keep newest, delete rest
  latest=$(ls -t "$CURSOR_EXT" 2>/dev/null | grep "anthropic.claude-code" | head -1)
  for ext in "$CURSOR_EXT"/anthropic.claude-code-*; do
    if [ -d "$ext" ] && [ "$(basename "$ext")" != "$latest" ]; then
      rm -rf "$ext"
      log "Deleted old Cursor extension: $(basename "$ext")"
    fi
  done
  # Clean .trash
  rm -rf "$HOME/Library/Application Support/Cursor/CachedExtensionVSIXs/.trash" 2>/dev/null
fi

# 5. Homebrew cache
brew cleanup --prune=7 2>/dev/null && log "Cleaned Homebrew cache"

# 6. pnpm store prune
pnpm store prune 2>/dev/null && log "Pruned pnpm store"

# 7. pip cache
pip3 cache purge 2>/dev/null && log "Purged pip cache"

AFTER=$(df -k / | awk 'NR==2{print $4}')
FREED=$(( (AFTER - BEFORE) / 1024 ))
log "=== Cleanup complete. Freed ~${FREED}MB ==="
