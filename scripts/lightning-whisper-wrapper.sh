#!/bin/bash
# lightning-whisper-wrapper.sh — Drop-in CLI wrapper for lightning-whisper-mlx
#
# Replaces whisper-cli with lightning-whisper-mlx (5-10x faster on Apple Silicon MLX).
# Accepts the same flags as whisper-cli for backward compatibility:
#
#   -m MODEL_PATH    Ignored (uses distil-large-v3 via MLX; the -m flag is accepted for compat)
#   -f FILE          Audio file to transcribe (required)
#   -l LANG          Language code (default: auto). "auto" maps to None.
#   --no-timestamps  Output plain text only (default behavior)
#   --output-srt     Write SRT file to -of path
#   --output-txt     Write TXT file to -of path
#   -of PREFIX       Output file prefix for --output-srt / --output-txt
#
# Environment:
#   WHISPER_MLX_MODEL    Override model (default: distil-large-v3)
#   WHISPER_MLX_BATCH    Override batch_size (default: 12)

set -euo pipefail

MODEL="${WHISPER_MLX_MODEL:-distil-large-v3}"
BATCH="${WHISPER_MLX_BATCH:-12}"
FILE=""
LANG=""
OUTPUT_SRT=false
OUTPUT_TXT=false
OUTPUT_PREFIX=""
NO_TIMESTAMPS=false

# Parse arguments (whisper-cli compatible)
while [[ $# -gt 0 ]]; do
    case "$1" in
        -m) shift; shift 2>/dev/null || true ;;  # Accept and ignore model path
        -f) FILE="$2"; shift 2 ;;
        -l) LANG="$2"; shift 2 ;;
        --no-timestamps) NO_TIMESTAMPS=true; shift ;;
        --output-srt) OUTPUT_SRT=true; shift ;;
        --output-txt) OUTPUT_TXT=true; shift ;;
        -of) OUTPUT_PREFIX="$2"; shift 2 ;;
        *) shift ;;
    esac
done

[ -z "$FILE" ] && { echo "Error: -f <audio-file> is required" >&2; exit 1; }
[ ! -f "$FILE" ] && { echo "Error: file not found: $FILE" >&2; exit 1; }

# Map language: "auto" → None (let the model detect), empty → None
LANG_ARG="None"
if [ -n "$LANG" ] && [ "$LANG" != "auto" ]; then
    LANG_ARG="\"$LANG\""
fi

# Run transcription
RESULT=$(python3 -c "
import sys, json

from lightning_whisper_mlx import LightningWhisperMLX

lang = $LANG_ARG
whisper = LightningWhisperMLX(model='$MODEL', batch_size=$BATCH, quant=None)
result = whisper.transcribe(audio_path='$FILE', language=lang if lang else None)

text = result.get('text', '')
print(text)
" 2>/dev/null) || { echo "[transcription failed]"; exit 1; }

# Output modes
if [ "$OUTPUT_SRT" = true ] && [ -n "$OUTPUT_PREFIX" ]; then
    # lightning-whisper-mlx doesn't produce SRT natively, write a single-block SRT
    DURATION=$(python3 -c "
import subprocess, json
r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '$FILE'], capture_output=True, text=True)
d = json.loads(r.stdout)
dur = float(d['format']['duration'])
h = int(dur // 3600)
m = int((dur % 3600) // 60)
s = int(dur % 60)
ms = int((dur % 1) * 1000)
print(f'{h:02d}:{m:02d}:{s:02d},{ms:03d}')
" 2>/dev/null || echo "00:10:00,000")

    cat > "${OUTPUT_PREFIX}.srt" <<SRTEOF
1
00:00:00,000 --> ${DURATION}
${RESULT}
SRTEOF
fi

if [ "$OUTPUT_TXT" = true ] && [ -n "$OUTPUT_PREFIX" ]; then
    echo "$RESULT" > "${OUTPUT_PREFIX}.txt"
fi

# Default: print to stdout (matches whisper-cli --no-timestamps behavior)
if [ "$OUTPUT_SRT" = false ] && [ "$OUTPUT_TXT" = false ]; then
    echo "$RESULT"
fi
