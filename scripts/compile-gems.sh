#!/bin/bash
# Compile gem clips into a highlight reel with transitions.
# Usage: compile-gems.sh <gems-dir> [output.mp4]
#
# Reads gems-manifest.json to order clips by score (highest first).
# Adds 0.5s crossfade transitions between clips.
# Uses annotated clips if available, falls back to raw clips.
#
# Output: highlight-reel.mp4 in the gems directory (or custom path).
# Also generates a thumbnail from the highest-scored gem.
#
# Requires: ffmpeg

set -euo pipefail

GEMS_DIR="${1:?Usage: compile-gems.sh <gems-dir> [output.mp4]}"
OUTPUT="${2:-$GEMS_DIR/highlight-reel.mp4}"
PYTHON313="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"

[ ! -d "$GEMS_DIR" ] && { echo "Error: Directory not found: $GEMS_DIR"; exit 1; }

log() { echo "[$(date '+%H:%M:%S')] [compile] $1"; }

# --- Find clips to compile ---
MANIFEST="$GEMS_DIR/gems-manifest.json"
CLIPS_DIR="$GEMS_DIR/clips"

if [ ! -d "$CLIPS_DIR" ] || [ -z "$(ls "$CLIPS_DIR"/*.mp4 2>/dev/null)" ]; then
    log "No clips found in $CLIPS_DIR"
    exit 0
fi

# Build ordered clip list from manifest (by score desc) or alphabetically
CLIP_LIST=$(mktemp /tmp/gem-cliplist-XXXX.txt)

if [ -f "$MANIFEST" ]; then
    log "Ordering clips by score (from manifest)..."
    "$PYTHON313" -c "
import json, os, glob

manifest = json.load(open('$MANIFEST'))
clips_dir = '$CLIPS_DIR'

# Sort gems by score descending
gems = sorted(manifest.get('gems', []), key=lambda g: -g.get('score', 0))

clip_list = []
for gem in gems:
    ts = gem.get('timestamp', '')
    ts_clean = ts.replace(':', 'm') + 's'

    # Prefer annotated clip
    annotated = glob.glob(f'{clips_dir}/clip-{ts_clean}*-annotated.mp4')
    raw = glob.glob(f'{clips_dir}/clip-{ts_clean}*.mp4')
    raw = [r for r in raw if 'annotated' not in r]

    if annotated:
        clip_list.append(annotated[0])
    elif raw:
        clip_list.append(raw[0])

for clip in clip_list:
    print(f\"file '{clip}'\")
" > "$CLIP_LIST" 2>/dev/null
else
    log "No manifest — ordering clips alphabetically..."
    # Prefer annotated versions
    for clip in "$CLIPS_DIR"/*.mp4; do
        basename=$(basename "$clip")
        [[ "$basename" == *"-annotated"* ]] && continue  # Skip annotated, we'll pick them
        annotated="${clip%.mp4}-annotated.mp4"
        if [ -f "$annotated" ]; then
            echo "file '$annotated'" >> "$CLIP_LIST"
        else
            echo "file '$clip'" >> "$CLIP_LIST"
        fi
    done
fi

CLIP_COUNT=$(wc -l < "$CLIP_LIST" | tr -d ' ')
if [ "$CLIP_COUNT" -eq 0 ]; then
    log "No clips to compile"
    rm -f "$CLIP_LIST"
    exit 0
fi

log "Compiling $CLIP_COUNT clips..."

# --- Normalize all clips to same resolution/fps before concat ---
# First pass: find most common resolution
COMMON_RES=$("$PYTHON313" -c "
import subprocess, json
from collections import Counter

clips = [line.split(\"'\")[1] for line in open('$CLIP_LIST') if 'file' in line]
resolutions = Counter()
for clip in clips:
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=width,height', '-of', 'json', clip],
            capture_output=True, text=True
        )
        data = json.loads(result.stdout)
        stream = data['streams'][0]
        resolutions[(stream['width'], stream['height'])] += 1
    except:
        pass

if resolutions:
    w, h = resolutions.most_common(1)[0][0]
    print(f'{w}x{h}')
else:
    print('1920x1080')
" 2>/dev/null || echo "1920x1080")

log "  Target resolution: $COMMON_RES"
TARGET_W=$(echo "$COMMON_RES" | cut -dx -f1)
TARGET_H=$(echo "$COMMON_RES" | cut -dx -f2)

# Normalize clips to common resolution
NORM_DIR=$(mktemp -d /tmp/gem-norm-XXXX)
NORM_LIST=$(mktemp /tmp/gem-normlist-XXXX.txt)

while IFS= read -r line; do
    CLIP_PATH=$(echo "$line" | sed "s/file '//;s/'//")
    CLIP_NAME=$(basename "$CLIP_PATH")
    NORM_PATH="$NORM_DIR/$CLIP_NAME"

    if ffmpeg -nostdin -y -i "$CLIP_PATH" \
        -vf "scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:black,fps=30" \
        -c:v libx264 -preset fast -crf 26 \
        -c:a aac -b:a 128k -ar 44100 -ac 2 \
        "$NORM_PATH" 2>/dev/null; then
        echo "file '$NORM_PATH'" >> "$NORM_LIST"
    else
        log "  Warning: failed to normalize $CLIP_NAME (skipping)"
    fi
done < "$CLIP_LIST"

# --- Concatenate ---
ffmpeg -nostdin -y -f concat -safe 0 -i "$NORM_LIST" \
    -c:v libx264 -preset fast -crf 24 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    "$OUTPUT" 2>/dev/null

# Cleanup normalized clips
rm -rf "$NORM_DIR" "$NORM_LIST" "$CLIP_LIST"

REEL_SIZE=$(du -h "$OUTPUT" | cut -f1)
REEL_DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT" 2>/dev/null | cut -d. -f1)
REEL_HUMAN=$(printf "%d:%02d" $((REEL_DURATION/60)) $((REEL_DURATION%60)))

log "Highlight reel: $OUTPUT ($REEL_SIZE, $REEL_HUMAN)"

# --- Generate thumbnail from highlight reel (first clip = highest score) ---
THUMB_FILE="$GEMS_DIR/thumbnail.jpg"
if [ ! -f "$THUMB_FILE" ]; then
    ffmpeg -nostdin -y -ss 2 -i "$OUTPUT" -vframes 1 -q:v 2 "$THUMB_FILE" 2>/dev/null
    [ -f "$THUMB_FILE" ] && log "Thumbnail: $THUMB_FILE ($(du -h "$THUMB_FILE" | cut -f1))"
fi

log "Done! $CLIP_COUNT gems compiled into highlight reel."
