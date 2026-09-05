#!/bin/bash
# Fetch Twitch VOD chat log and convert to simplified JSON.
# Usage: fetch-chat.sh <twitch-vod-id> <output-file>
#
# Requires: TwitchDownloaderCLI (brew install twitchdownloader)
# If not installed, exits with code 2 (caller should treat as "no chat available").
#
# Output format (simplified JSON):
#   [{"time_s": 12.3, "user": "viewer1", "message": "PogChamp"}, ...]

set -euo pipefail

VOD_ID="${1:?Usage: fetch-chat.sh <twitch-vod-id> <output-file>}"
OUTPUT="${2:?Usage: fetch-chat.sh <twitch-vod-id> <output-file>}"

log() { echo "[$(date '+%H:%M:%S')] [fetch-chat] $1"; }

# Check for TwitchDownloaderCLI
if ! command -v TwitchDownloaderCLI &>/dev/null; then
    log "TwitchDownloaderCLI not found. Install: brew install twitchdownloader"
    log "Skipping chat fetch — pipeline will run without chat signals."
    exit 2
fi

# Strip URL prefix if full URL given (extract just the VOD ID)
VOD_ID="${VOD_ID##*/}"
VOD_ID="${VOD_ID%%\?*}"

RAW_CHAT="$(dirname "$OUTPUT")/chat-raw.json"

# Download chat (TwitchDownloader outputs its own JSON format)
if [ ! -f "$RAW_CHAT" ]; then
    log "Downloading chat for VOD $VOD_ID..."
    TwitchDownloaderCLI chatdownload \
        --id "$VOD_ID" \
        -o "$RAW_CHAT" \
        --timestamp-format Relative 2>&1 | while IFS= read -r line; do
        # Only show progress lines, not spam
        [[ "$line" == *"%"* ]] && printf "\r  %s" "$line"
    done
    echo ""
    log "Raw chat downloaded: $(du -sh "$RAW_CHAT" | cut -f1)"
else
    log "Raw chat exists, skipping download"
fi

# Convert TwitchDownloader JSON to simplified format
log "Converting to simplified format..."
python3 -c "
import json, sys

with open('$RAW_CHAT') as f:
    raw = json.load(f)

comments = raw.get('comments', [])
if not comments:
    print('[]')
    sys.exit(0)

simplified = []
for c in comments:
    offset = c.get('content_offset_seconds', 0)
    user = c.get('commenter', {}).get('display_name', 'unknown')
    msg = c.get('message', {}).get('body', '')
    if msg:
        simplified.append({
            'time_s': round(offset, 1),
            'user': user,
            'message': msg
        })

with open('$OUTPUT', 'w') as f:
    json.dump(simplified, f, indent=2, ensure_ascii=False)

print(f'Converted {len(simplified)} messages')
" 2>/dev/null

if [ -f "$OUTPUT" ]; then
    MSG_COUNT=$(python3 -c "import json; print(len(json.load(open('$OUTPUT'))))" 2>/dev/null || echo "?")
    log "Chat saved: $OUTPUT ($MSG_COUNT messages)"
else
    log "Warning: Failed to convert chat. Creating empty array."
    echo "[]" > "$OUTPUT"
fi
