#!/bin/bash
# Gem Pipeline — end-to-end gem detection for Twitch/YouTube streams.
# Usage: gem-pipeline.sh <url> [--streamer NAME] [--output-dir DIR] [--keep-video]
#
# Pipeline:
#   1. Download VOD (yt-dlp, best quality ≤1080p)
#   2. Fetch chat log (TwitchDownloader for Twitch, skip for YouTube)
#   3. Run process-stream.sh (audio + video + scoring)
#   4. Generate gems-manifest.json
#   5. Cleanup large intermediates (full audio WAV, raw frames)
#
# Output: ~/gems/<streamer>/<date>/
#   ├── gems-manifest.json   # Ranked gems with timestamps, scores, signals
#   ├── transcript.md        # Full whisper transcript with timestamps
#   ├── gems.md              # Human-readable gem list
#   ├── clips/               # 10s video clips of top gems
#   └── metadata.json        # VOD info, duration, streamer, chat stats
#
# Resumable: re-running skips completed steps (checks for existing files).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GEMS_ROOT="${HOME}/gems"

# --- Parse arguments ---
URL=""
STREAMER=""
OUTPUT_DIR=""
KEEP_VIDEO=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --streamer)  STREAMER="$2"; shift 2 ;;
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --keep-video) KEEP_VIDEO=true; shift ;;
        --help|-h)
            echo "Usage: gem-pipeline.sh <url> [--streamer NAME] [--output-dir DIR] [--keep-video]"
            echo ""
            echo "Options:"
            echo "  --streamer NAME   Override streamer/channel name (auto-detected from URL)"
            echo "  --output-dir DIR  Override output directory (default: ~/gems/<streamer>/<date>/)"
            echo "  --keep-video      Don't delete the downloaded video after processing"
            echo ""
            echo "Supported: Twitch VODs, YouTube videos"
            exit 0
            ;;
        -*) echo "Unknown option: $1"; exit 1 ;;
        *)  URL="$1"; shift ;;
    esac
done

[ -z "$URL" ] && { echo "Error: URL required. Usage: gem-pipeline.sh <url>"; exit 1; }

log() { echo "[$(date '+%H:%M:%S')] [gem-pipeline] $1"; }
die() { log "ERROR: $1"; exit 1; }

# --- Detect platform ---
detect_platform() {
    case "$URL" in
        *twitch.tv/videos/*|*twitch.tv/*/v/*)
            echo "twitch"
            ;;
        *youtube.com/*|*youtu.be/*)
            echo "youtube"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

PLATFORM=$(detect_platform)
log "Platform: $PLATFORM"

# --- Auto-detect streamer name ---
if [ -z "$STREAMER" ]; then
    case "$PLATFORM" in
        twitch)
            # Try to extract from yt-dlp metadata (fast, no download)
            STREAMER=$(yt-dlp --print uploader "$URL" 2>/dev/null || echo "")
            [ -z "$STREAMER" ] && STREAMER="twitch-unknown"
            ;;
        youtube)
            STREAMER=$(yt-dlp --print channel "$URL" 2>/dev/null || echo "")
            [ -z "$STREAMER" ] && STREAMER="youtube-unknown"
            ;;
        *)
            STREAMER="unknown"
            ;;
    esac
    # Sanitize: lowercase, replace spaces with hyphens, strip special chars
    STREAMER=$(echo "$STREAMER" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9_-]//g')
fi

DATE=$(date +%Y-%m-%d)

# --- Setup output directory ---
if [ -z "$OUTPUT_DIR" ]; then
    OUTPUT_DIR="${GEMS_ROOT}/${STREAMER}/${DATE}"
fi
mkdir -p "$OUTPUT_DIR" "$OUTPUT_DIR/clips" "$OUTPUT_DIR/frames"

log "Streamer: $STREAMER"
log "Output: $OUTPUT_DIR"

# --- Write progress tracker ---
PROGRESS_FILE="$OUTPUT_DIR/.pipeline-progress"
touch "$PROGRESS_FILE"

step_done() { grep -q "^$1$" "$PROGRESS_FILE" 2>/dev/null; }
mark_done() { echo "$1" >> "$PROGRESS_FILE"; }

# ============================================================
# STEP 1: DOWNLOAD VOD
# ============================================================

VIDEO_FILE="$OUTPUT_DIR/video.mp4"

if step_done "download" && [ -f "$VIDEO_FILE" ]; then
    log "Step 1: Video already downloaded, skipping"
else
    log "Step 1: Downloading VOD..."

    if ! command -v yt-dlp &>/dev/null; then
        die "yt-dlp not found. Install: brew install yt-dlp"
    fi

    yt-dlp \
        -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" \
        --merge-output-format mp4 \
        -o "$VIDEO_FILE" \
        --no-playlist \
        "$URL" || true

    if [ ! -f "$VIDEO_FILE" ]; then
        die "Download failed — no video file produced"
    fi

    log "  Downloaded: $(du -sh "$VIDEO_FILE" | cut -f1)"
    mark_done "download"
fi

# --- Get video duration and metadata ---
DURATION_S=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO_FILE" 2>/dev/null | cut -d. -f1)
DURATION_HUMAN=$(printf "%d:%02d:%02d" $((DURATION_S/3600)) $(((DURATION_S%3600)/60)) $((DURATION_S%60)))
log "  Duration: $DURATION_HUMAN ($DURATION_S seconds)"

# --- Write metadata.json ---
METADATA_FILE="$OUTPUT_DIR/metadata.json"
if [ ! -f "$METADATA_FILE" ]; then
    python3 -c "
import json
metadata = {
    'vod_url': '$URL',
    'platform': '$PLATFORM',
    'streamer': '$STREAMER',
    'date': '$DATE',
    'duration_s': $DURATION_S,
    'duration_human': '$DURATION_HUMAN',
    'video_file': 'video.mp4',
    'pipeline_version': 1
}
with open('$METADATA_FILE', 'w') as f:
    json.dump(metadata, f, indent=2)
print('  Metadata written')
"
fi

# ============================================================
# STEP 2: FETCH CHAT LOG (Twitch only)
# ============================================================

CHAT_FILE="$OUTPUT_DIR/chat.json"
CHAT_ARG=""

if [ "$PLATFORM" = "twitch" ]; then
    if step_done "chat" && [ -f "$CHAT_FILE" ]; then
        log "Step 2: Chat already fetched, skipping"
        CHAT_ARG="$CHAT_FILE"
    else
        log "Step 2: Fetching Twitch chat..."
        # Extract VOD ID from URL
        VOD_ID=$(echo "$URL" | grep -o '[0-9]\{8,\}' | head -1)

        if [ -n "$VOD_ID" ]; then
            "$SCRIPT_DIR/fetch-chat.sh" "$VOD_ID" "$CHAT_FILE" && CHAT_ARG="$CHAT_FILE" || true

            if [ -f "$CHAT_FILE" ]; then
                # Convert JSON chat to text format for process-stream.sh
                CHAT_TEXT="$OUTPUT_DIR/chat.txt"
                python3 -c "
import json
with open('$CHAT_FILE') as f:
    messages = json.load(f)
with open('$CHAT_TEXT', 'w') as f:
    for m in messages:
        secs = int(m.get('time_s', 0))
        h, rem = divmod(secs, 3600)
        mins, s = divmod(rem, 60)
        f.write(f'[{h:02d}:{mins:02d}:{s:02d}] {m[\"user\"]}: {m[\"message\"]}\n')
print(f'Converted {len(messages)} messages to text format')
" 2>/dev/null
                CHAT_ARG="$CHAT_TEXT"
                mark_done "chat"
            fi
        else
            log "  Could not extract VOD ID from URL"
        fi
    fi
else
    log "Step 2: Not a Twitch VOD — skipping chat fetch"
fi

# ============================================================
# STEP 3: RUN PROCESS-STREAM.SH
# ============================================================

if step_done "process" && [ -f "$OUTPUT_DIR/transcript.md" ]; then
    log "Step 3: Already processed, skipping"
else
    log "Step 3: Running stream processing pipeline..."

    # process-stream.sh expects: <video-file> [chat-log] [--json-output] [--chat-json]
    STREAM_ARGS=("$VIDEO_FILE")
    [ -n "$CHAT_ARG" ] && STREAM_ARGS+=("$CHAT_ARG")
    STREAM_ARGS+=("--json-output")
    # If chat was from fetch-chat.sh (JSON format), pass --chat-json
    [[ "$CHAT_ARG" == *.json ]] && STREAM_ARGS+=("--chat-json")

    "$SCRIPT_DIR/process-stream.sh" "${STREAM_ARGS[@]}"

    mark_done "process"
fi

# ============================================================
# STEP 4: GENERATE GEMS-MANIFEST.JSON
# ============================================================

MANIFEST_FILE="$OUTPUT_DIR/gems-manifest.json"
GEMS_FILE="$OUTPUT_DIR/gems.md"

if [ -f "$GEMS_FILE" ] && [ ! -f "$MANIFEST_FILE" ]; then
    log "Step 4: Generating gems-manifest.json..."

    python3 -c "
import json, re, os

gems_path = '$GEMS_FILE'
manifest_path = '$MANIFEST_FILE'
clips_dir = '$OUTPUT_DIR/clips'

with open(gems_path) as f:
    text = f.read()

# Parse gems from markdown
# Format: ### [MM:SS] Title\n**Score:** N/10 | **Type:** type
gems = []
pattern = r'### \[([^\]]+)\]\s+(.+?)$\n\*\*Score:\*\*\s+(\d+)/10\s+\|\s+\*\*Type:\*\*\s+(\S+)'
for match in re.finditer(pattern, text, re.MULTILINE):
    ts, title, score, gtype = match.groups()

    # Parse timestamp to seconds
    parts = ts.split(':')
    secs = 0
    for p in parts:
        secs = secs * 60 + int(p)

    gem_id = f'gem-{len(gems)+1:03d}'

    # Check for clip
    ts_clean = ts.replace(':', 'm') + 's'
    clip_path = None
    for ext in ['mp4']:
        candidate = f'clips/clip-{ts_clean}.{ext}'
        if os.path.exists(os.path.join('$OUTPUT_DIR', candidate)):
            clip_path = candidate
            break

    # Check for frame
    frame_path = None
    mins, s = divmod(secs, 60)
    frame_name = f'frames/frame-{mins}m{s}s.jpg'
    if os.path.exists(os.path.join('$OUTPUT_DIR', frame_name)):
        frame_path = frame_name

    gems.append({
        'id': gem_id,
        'timestamp': ts,
        'start_s': max(0, secs - 5),
        'end_s': secs + 5,
        'score': int(score),
        'type': gtype,
        'title': title.strip(),
        'clip_path': clip_path,
        'frame_path': frame_path
    })

manifest = {
    'version': 1,
    'vod_url': '$URL',
    'streamer': '$STREAMER',
    'date': '$DATE',
    'duration_s': $DURATION_S,
    'gem_count': len(gems),
    'gems': sorted(gems, key=lambda g: -g['score'])
}

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print(f'Manifest written: {len(gems)} gems')
" 2>/dev/null

    if [ -f "$MANIFEST_FILE" ]; then
        GEM_COUNT=$(python3 -c "import json; print(json.load(open('$MANIFEST_FILE'))['gem_count'])" 2>/dev/null || echo "?")
        log "  Manifest: $GEM_COUNT gems"
    fi
elif [ -f "$MANIFEST_FILE" ]; then
    log "Step 4: Manifest already exists, skipping"
else
    log "Step 4: No gems.md yet — manifest will be generated after scoring"
fi

# ============================================================
# STEP 5: COMPILE HIGHLIGHT REEL (if clips exist)
# ============================================================

REEL_FILE="$OUTPUT_DIR/highlight-reel.mp4"
COMPILE_SCRIPT="$SCRIPT_DIR/compile-gems.sh"

if [ -x "$COMPILE_SCRIPT" ] && [ -d "$OUTPUT_DIR/clips" ]; then
    CLIP_COUNT=$(find "$OUTPUT_DIR/clips" -name "*.mp4" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$CLIP_COUNT" -gt 0 ] && [ ! -f "$REEL_FILE" ]; then
        log "Step 5: Compiling $CLIP_COUNT clips into highlight reel..."
        "$COMPILE_SCRIPT" "$OUTPUT_DIR" "$REEL_FILE" || log "  Warning: compilation failed (non-fatal)"
    elif [ -f "$REEL_FILE" ]; then
        log "Step 5: Highlight reel already exists, skipping"
    else
        log "Step 5: No clips to compile"
    fi
else
    log "Step 5: No compile script or clips directory"
fi

# ============================================================
# STEP 6: INGEST INTO BRAINLAYER
# ============================================================

INGEST_SCRIPT="$SCRIPT_DIR/ingest-gems.sh"
INGESTED_MARKER="$OUTPUT_DIR/.brainlayer-ingested"

if [ -x "$INGEST_SCRIPT" ] && [ -f "$MANIFEST_FILE" ] && [ ! -f "$INGESTED_MARKER" ]; then
    log "Step 6: Ingesting gems into BrainLayer..."
    "$INGEST_SCRIPT" "$OUTPUT_DIR" || log "  Warning: ingestion failed (non-fatal)"
elif [ -f "$INGESTED_MARKER" ]; then
    log "Step 6: Already ingested into BrainLayer, skipping"
elif [ ! -f "$MANIFEST_FILE" ]; then
    log "Step 6: No manifest yet — BrainLayer ingestion deferred"
fi

# ============================================================
# STEP 7: CLEANUP
# ============================================================

log "Step 7: Cleaning up intermediates..."

# Remove segment WAVs (already done by process-stream.sh, but double-check)
SEGMENT_COUNT=$(find "$OUTPUT_DIR" -maxdepth 1 -name "segment-*.wav" 2>/dev/null | wc -l | tr -d ' ')
if [ "$SEGMENT_COUNT" -gt 0 ]; then
    log "  Removing $SEGMENT_COUNT segment WAVs"
    rm -f "$OUTPUT_DIR"/segment-*.wav
fi

# Remove full audio WAV (large, regeneratable from video)
if [ -f "$OUTPUT_DIR/full-audio.wav" ]; then
    AUDIO_SIZE=$(du -sh "$OUTPUT_DIR/full-audio.wav" | cut -f1)
    log "  Removing full-audio.wav ($AUDIO_SIZE)"
    rm -f "$OUTPUT_DIR/full-audio.wav"
fi

# Remove quiet-frames.txt (intermediate)
rm -f "$OUTPUT_DIR/quiet-frames.txt"

# Remove raw chat download (keep simplified version)
rm -f "$OUTPUT_DIR/chat-raw.json"

# Optionally remove video
if [ "$KEEP_VIDEO" = false ]; then
    if [ -f "$VIDEO_FILE" ]; then
        VIDEO_SIZE=$(du -sh "$VIDEO_FILE" | cut -f1)
        log "  Removing video ($VIDEO_SIZE) — use --keep-video to preserve"
        rm -f "$VIDEO_FILE"
    fi
fi

# ============================================================
# SUMMARY
# ============================================================

log ""
log "=== GEM PIPELINE COMPLETE ==="
log "Output: $OUTPUT_DIR"
log "Total disk: $(du -sh "$OUTPUT_DIR" | cut -f1)"
log ""
log "Key files:"
[ -f "$OUTPUT_DIR/gems-manifest.json" ] && log "  gems-manifest.json — structured gem data"
[ -f "$OUTPUT_DIR/highlight-reel.mp4" ] && log "  highlight-reel.mp4 — compiled highlight reel"
[ -f "$OUTPUT_DIR/thumbnail.jpg" ] && log "  thumbnail.jpg — reel thumbnail"
[ -f "$OUTPUT_DIR/gems.md" ] && log "  gems.md — human-readable gem list"
[ -f "$OUTPUT_DIR/transcript.md" ] && log "  transcript.md — full transcript"
[ -f "$OUTPUT_DIR/metadata.json" ] && log "  metadata.json — VOD metadata"
CLIP_COUNT=$(find "$OUTPUT_DIR/clips" -name "*.mp4" 2>/dev/null | wc -l | tr -d ' ')
[ "$CLIP_COUNT" -gt 0 ] && log "  clips/ — $CLIP_COUNT video clips"
FRAME_COUNT=$(find "$OUTPUT_DIR/frames" -name "*.jpg" 2>/dev/null | wc -l | tr -d ' ')
[ "$FRAME_COUNT" -gt 0 ] && log "  frames/ — $FRAME_COUNT screenshots"
log ""
log "Re-run this command to resume from any failed step."
