#!/bin/bash
# Annotate a video clip with a lower-third text overlay.
# Uses Python/Pillow to create overlay PNG, ffmpeg to composite.
# Usage: annotate-clip.sh <clip.mp4> <title> <context> [output.mp4]

set -euo pipefail

CLIP="${1:?Usage: annotate-clip.sh <clip.mp4> <title> <context> [output.mp4]}"
TITLE="${2:?Missing title}"
CONTEXT="${3:?Missing context line}"
OUTPUT="${4:-${CLIP%.mp4}-annotated.mp4}"

# Get video dimensions
WIDTH=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$CLIP" 2>/dev/null)
HEIGHT=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$CLIP" 2>/dev/null)

BAR_HEIGHT=90
OVERLAY_PNG=$(mktemp /tmp/gem-overlay-XXXX.png)

# Create lower-third overlay with Pillow
# Pass values via env vars to avoid shell-to-Python injection
GEM_TITLE="$TITLE" GEM_CONTEXT="$CONTEXT" GEM_WIDTH="$WIDTH" \
GEM_BAR_HEIGHT="$BAR_HEIGHT" GEM_OUTPUT="$OVERLAY_PNG" \
python3 << 'PYEOF'
import os
from PIL import Image, ImageDraw, ImageFont

W, BAR_H = int(os.environ["GEM_WIDTH"]), int(os.environ["GEM_BAR_HEIGHT"])
img = Image.new("RGBA", (W, BAR_H), (0, 0, 0, 190))
draw = ImageDraw.Draw(img)

# Use macOS system font
try:
    title_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
    ctx_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 17)
except:
    try:
        title_font = ImageFont.truetype("/System/Library/Fonts/SFNSMono.ttf", 24)
        ctx_font = ImageFont.truetype("/System/Library/Fonts/SFNSMono.ttf", 17)
    except:
        title_font = ImageFont.load_default()
        ctx_font = ImageFont.load_default()

draw.text((16, 12), os.environ["GEM_TITLE"], fill=(255, 255, 255, 255), font=title_font)
draw.text((16, 48), os.environ["GEM_CONTEXT"], fill=(255, 255, 255, 230), font=ctx_font)

img.save(os.environ["GEM_OUTPUT"])
PYEOF

# Composite overlay onto clip at bottom
ffmpeg -y -i "$CLIP" -i "$OVERLAY_PNG" \
  -filter_complex "[1]format=rgba[ov];[0][ov]overlay=0:H-${BAR_HEIGHT}" \
  -c:v libx264 -preset fast -crf 28 \
  -c:a copy \
  "$OUTPUT" 2>/dev/null

rm -f "$OVERLAY_PNG"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "$SIZE → $OUTPUT"
