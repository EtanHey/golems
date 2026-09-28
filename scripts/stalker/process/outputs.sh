#!/bin/bash
# Sourced only by process-stream.sh; no top-level side effects.
# run_clip_stage globals (R): GEMS_FILE, OUT_DIR, VIDEO, original $0;
# (W): no cross-stage globals (CLIP_COUNT and ANNOTATE_SCRIPT are scratch).
# Files: clips/*, optional annotated clips, 4-clips marker.
# run_manifest_stage globals (R): JSON_OUTPUT, GEMS_FILE, OUT_DIR, VIDEO,
# SPIKES_FILE, VOLUME_FILE, STREAMER, DATE; (W): MANIFEST_FILE. Files:
# gems-manifest.json and 5-manifest marker. DURATION is scratch.
# complete_stream_run globals (R): OUT_DIR, CHAT_LOG, GEMS_FILE, VIDEO,
# TRANSCRIPT, SEG_NUM, SPIKES_FILE, SIGNALS_FILE, SCRIPT_DIR, delivery env;
# (W): no cross-stage globals (SEGMENT_SIZE and SEGMENT_COUNT_FILES are scratch).
# It removes regeneratable segment WAVs, gates quality,
# invokes completion once unless deferred, and prints final paths/status.

run_clip_stage() {
# GEMS_FILE already set above
if [ -f "$GEMS_FILE" ]; then
    log "Pass 4: Extracting clips for existing gems..."
    # Parse gem timestamps from gems.md (format: ### [MM:SS] or ### [HH:MM:SS])
    CLIP_COUNT=0
    # Extract timestamps from gems.md (macOS-compatible, no grep -P)
    while IFS= read -r TS; do
        [ -z "$TS" ] && continue
        # Parse MM:SS or HH:MM:SS to seconds
        PARTS=$(echo "$TS" | tr ':' ' ')
        SECS=0
        for P in $PARTS; do
            SECS=$(( SECS * 60 + ${P#0} ))
        done

        CLIP_NAME="clip-$(echo "$TS" | tr ':' 'm')s"
        CLIP_FILE="$OUT_DIR/clips/${CLIP_NAME}.mp4"

        if [ ! -f "$CLIP_FILE" ]; then
            START=$((SECS - 10))
            [ $START -lt 0 ] && START=0
            ffmpeg -nostdin -y -ss "$START" -i "$VIDEO" -t 45 \
                -c:v libx264 -preset fast -crf 28 \
                -c:a aac -b:a 64k \
                -movflags +faststart \
                "$CLIP_FILE" 2>/dev/null
            log "  Clip: $CLIP_NAME ($(du -h "$CLIP_FILE" | cut -f1))"
            CLIP_COUNT=$((CLIP_COUNT + 1))
        fi
    done < <(sed -n 's/^### \[\([0-9:]*\)\].*/\1/p' "$GEMS_FILE" 2>/dev/null)
    log "  Extracted $CLIP_COUNT new clips"

    # --- 4b: Auto-annotate clips if annotate-clip.sh exists ---
    ANNOTATE_SCRIPT="$(dirname "$0")/annotate-clip.sh"
    if [ -x "$ANNOTATE_SCRIPT" ]; then
        log "Pass 4b: Annotating clips..."
        # Parse gem titles and context from gems.md for annotation
        # Format: ### [MM:SS] Title\n**Score:** X/10 | **Type:** Y
        python3 -c "
import re, subprocess, os, glob

gems_path = '$GEMS_FILE'
clips_dir = '$OUT_DIR/clips'
script = '$ANNOTATE_SCRIPT'

with open(gems_path) as f:
    text = f.read()

# Find gems: ### [timestamp] title
gems = re.findall(r'### \[([^\]]+)\]\s+(.+?)$\n\*\*Score:\*\*\s+(\d+/10)\s+\|\s+\*\*Type:\*\*\s+(\w+[/\w]*)', text, re.MULTILINE)

for ts, title, score, gtype in gems:
    # Find matching clip
    ts_clean = ts.replace(':', 'm') + 's'
    matches = glob.glob(f'{clips_dir}/clip-{ts_clean}*.mp4')
    matches = [m for m in matches if 'annotated' not in m]
    if not matches:
        continue
    clip = matches[0]
    out = clip.replace('.mp4', '-annotated.mp4')
    if os.path.exists(out):
        continue

    header = f'{title}  |  {score}  |  {gtype}'
    # Get first context line after the gem header (skip score line)
    idx = text.find(f'### [{ts}]')
    context = ''
    if idx >= 0:
        lines_after = text[idx:idx+500].split('\n')
        for line in lines_after[2:]:
            if line.startswith('**') and 'Transcript' in line:
                continue
            if line.startswith('**') and 'Screen' in line:
                continue
            if line.startswith('**') and 'Context' in line:
                context = line.split(':', 1)[1].strip() if ':' in line else ''
                break
            if line.startswith('**') and 'Relevance' in line:
                context = line.split(':', 1)[1].strip() if ':' in line else ''
                break
    if not context:
        context = title

    subprocess.run([script, clip, header, context, out], capture_output=True)
    if os.path.exists(out):
        print(f'  Annotated: {os.path.basename(out)}')
" 2>/dev/null
    fi
else
    log "Pass 4: No gems.md yet — skipping clip extraction"
fi
mark_stalker_stage_done "$OUT_DIR" "4-clips"
}

run_manifest_stage() {
MANIFEST_FILE="$OUT_DIR/gems-manifest.json"
if [ "$JSON_OUTPUT" = true ] && [ -f "$GEMS_FILE" ] && [ ! -f "$MANIFEST_FILE" ]; then
    log "Pass 5: Generating gems-manifest.json..."
    DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO" 2>/dev/null | cut -d. -f1 || echo "0")

    python3 -c "
import json, re, os

gems_path = '$GEMS_FILE'
manifest_path = '$MANIFEST_FILE'
spikes_path = '$SPIKES_FILE'
volume_path = '$VOLUME_FILE'

with open(gems_path) as f:
    text = f.read()

# Parse gems from markdown
pattern = r'### \[([^\]]+)\]\s+(.+?)$\n\*\*Score:\*\*\s+(\d+)/10\s+\|\s+\*\*Type:\*\*\s+(\S+)'
gems = []
for match in re.finditer(pattern, text, re.MULTILINE):
    ts, title, score, gtype = match.groups()

    # Parse timestamp to seconds
    parts = ts.split(':')
    secs = 0
    for p in parts:
        secs = secs * 60 + int(p)

    gem_id = f'gem-{len(gems)+1:03d}'

    # Check for volume spike at this timestamp
    volume_spike = False
    if os.path.exists(spikes_path):
        with open(spikes_path) as f:
            for line in f:
                if line.startswith('#'): continue
                parts_v = line.strip().split()
                if parts_v and abs(int(parts_v[0]) - secs) <= 10:
                    volume_spike = True
                    break

    # Check for clip and frame
    mins, s = divmod(secs, 60)
    clip_name = f'clip-{ts.replace(\":\", \"m\")}s.mp4'
    clip_path = f'clips/{clip_name}' if os.path.exists(os.path.join('$OUT_DIR', 'clips', clip_name)) else None
    frame_name = f'frame-{mins}m{s}s.jpg'
    frame_path = f'frames/{frame_name}' if os.path.exists(os.path.join('$OUT_DIR', 'frames', frame_name)) else None

    # Extract transcript snippet from gems.md
    idx = text.find(f'### [{ts}]')
    transcript = ''
    if idx >= 0:
        block = text[idx:idx+1000]
        lines = block.split('\n')
        for line in lines[3:]:
            if line.startswith('### [') or line.startswith('---'):
                break
            if line.strip() and not line.startswith('**'):
                transcript += line.strip() + ' '
        transcript = transcript.strip()[:300]

    gems.append({
        'id': gem_id,
        'timestamp': ts,
        'start_s': max(0, secs - 5),
        'end_s': secs + 5,
        'score': int(score),
        'type': gtype,
        'title': title.strip(),
        'signals': {
            'volume_spike': volume_spike,
        },
        'transcript': transcript,
        'clip_path': clip_path,
        'frame_path': frame_path
    })

manifest = {
    'version': 1,
    'vod_url': '',
    'streamer': '$STREAMER',
    'date': '$DATE',
    'duration_s': int('$DURATION' or 0),
    'gem_count': len(gems),
    'gems': sorted(gems, key=lambda g: -g['score'])
}

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print(f'  Manifest: {len(gems)} gems written to gems-manifest.json')
" 2>/dev/null

elif [ "$JSON_OUTPUT" = true ] && [ -f "$MANIFEST_FILE" ]; then
    log "Pass 5: Manifest already exists, skipping"
elif [ "$JSON_OUTPUT" = true ]; then
    log "Pass 5: No gems.md yet — manifest generation deferred"
fi
if [ "$JSON_OUTPUT" = true ]; then
    mark_stalker_stage_done "$OUT_DIR" "5-manifest"
fi
}

complete_stream_run() {
SEGMENT_SIZE=$(du -sh "$OUT_DIR"/segment-*.wav 2>/dev/null | tail -1 | cut -f1 || echo "0")
SEGMENT_COUNT_FILES=$(find "$OUT_DIR" -maxdepth 1 -name "segment-*.wav" 2>/dev/null | wc -l | tr -d ' ')
if [ "$SEGMENT_COUNT_FILES" -gt 0 ]; then
    log "Cleanup: Removing $SEGMENT_COUNT_FILES segment WAVs ($SEGMENT_SIZE total)"
    rm -f "$OUT_DIR"/segment-*.wav
fi

if ! stalker_require_run_quality "$OUT_DIR" "$CHAT_LOG" "complete-notify"; then
    log "Stalker FAILED at stage 6: pipeline quality gate failed; delivery remains open"
    exit 75
fi
if [ "${STALKER_DEFER_DELIVERY:-0}" != "1" ]; then
    node "${STALKER_COMPLETION_SCRIPT:-$SCRIPT_DIR/stalker-complete-run.mjs}" "$OUT_DIR"
fi

log ""
log "=== MEDIA ANALYSIS FINISHED ==="
log "Directory: $OUT_DIR"
log "Transcript: $TRANSCRIPT ($SEG_NUM segments)"
log "Volume spikes: $SPIKES_FILE"
log "Frames: $OUT_DIR/frames/ ($(ls "$OUT_DIR/frames/" 2>/dev/null | wc -l | tr -d ' ') files)"
log "Clips: $OUT_DIR/clips/ ($(ls "$OUT_DIR/clips/" 2>/dev/null | wc -l | tr -d ' ') files)"
log "Combined signals: $SIGNALS_FILE"
[ -f "$GEMS_FILE" ] && log "Gems: $GEMS_FILE"
log ""
log "Total disk: $(du -sh "$OUT_DIR" | cut -f1)"
log ""
log "Cleanup options:"
log "  rm $OUT_DIR/segment-*.wav     # Segment audio (~50MB)"
log "  rm $OUT_DIR/full-audio.wav    # Full audio (~50MB)"
log "  rm $VIDEO                      # Full video (biggest)"
}
