#!/bin/bash
# Backup docs.local to iCloud Drive
# Scheduled via launchd plist: com.golems.backup-docs-local.plist
#
# Excludes: stalker-golem (11GB), logs, scratch
# Destination: ~/Library/Mobile Documents/com~apple~CloudDocs/golems-docs-local/

set -euo pipefail

SRC="$HOME/Gits/golems/docs.local/"
DST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/golems-docs-local/"

mkdir -p "$DST"

rsync -av --delete \
  --exclude='stalker-golem/' \
  --exclude='logs/' \
  --exclude='scratch/' \
  --exclude='.DS_Store' \
  --exclude='*.pyc' \
  --exclude='__pycache__/' \
  "$SRC" "$DST"

echo "$(date '+%Y-%m-%d %H:%M:%S') Backup complete: $(du -sh "$DST" | cut -f1)" >> "$HOME/.golems-zikaron/backup.log"
