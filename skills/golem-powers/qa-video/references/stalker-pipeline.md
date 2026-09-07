# Stalker Pipeline — Full Technical Reference

> Originally built for Theo's Twitch streams, adapted for QA screen recordings.

## Complete Command Reference

### Audio Extraction
```bash
ffmpeg -i "$VIDEO" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$WORKDIR/audio.wav"
```
- `-vn`: no video
- `-acodec pcm_s16le`: 16-bit PCM (whisper-cli expects this)
- `-ar 16000`: 16kHz sample rate (whisper optimal)
- `-ac 1`: mono

### Transcription
```bash
whisper-cli -m ~/.cache/whisper/ggml-small.bin \
  -f "$WORKDIR/audio.wav" \
  --output-srt --output-txt \
  -of "$WORKDIR/transcript" \
  -l auto
```

**Model options:**
| Model | Size | Speed (7min video) | Accuracy | When to use |
|-------|------|---------------------|----------|-------------|
| ggml-small | 466MB | ~14s | Good | Default for QA (English) |
| ggml-medium | 1.5GB | ~45s | Better | Mixed languages or unclear audio |
| ggml-large-v3 | 3.1GB | ~70s | Best | Critical QA, bad audio quality |

**Fallback:**
```bash
mlx_whisper "$WORKDIR/audio.wav" --model mlx-community/whisper-small --output-dir "$WORKDIR"
```

### Frame Extraction

**Single frame at timestamp:**
```bash
ffmpeg -ss 154 -i "$VIDEO" -vframes 1 -q:v 2 "$FRAMEDIR/frame-154s.jpg"
```

**Batch extraction at regular intervals:**
```bash
DURATION=$(ffprobe -v quiet -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$VIDEO" | cut -d. -f1)

for t in $(seq 0 30 "$DURATION"); do
  ffmpeg -ss "$t" -i "$VIDEO" -vframes 1 -q:v 2 "$FRAMEDIR/interval-${t}s.jpg" 2>/dev/null
done
```

**Hotspot with context frames (-5s, 0s, +5s):**
```bash
HOTSPOT=154
for offset in -5 0 5; do
  ts=$((HOTSPOT + offset))
  [ "$ts" -lt 0 ] && continue
  label="before5s"
  [ "$offset" -eq 0 ] && label="at"
  [ "$offset" -eq 5 ] && label="after5s"
  ffmpeg -ss "$ts" -i "$VIDEO" -vframes 1 -q:v 2 \
    "$FRAMEDIR/hotspot-${HOTSPOT}s-${label}.jpg" 2>/dev/null
done
```

**Quality:** Always use `-q:v 2` (high quality JPEG). Don't use PNG — too large for many frames.

### Video Metadata
```bash
# Duration
ffprobe -v quiet -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$VIDEO"

# Creation time (for click timestamp alignment)
ffprobe -v quiet -show_entries format_tags=creation_time \
  -of default=noprint_wrappers=1:nokey=1 "$VIDEO"

# Resolution
ffprobe -v quiet -show_entries stream=width,height \
  -of default=noprint_wrappers=1:nokey=1 "$VIDEO"
```

## Automated Hotspot Detection (Advanced)

These signals were part of the original Twitch stalker pipeline. For QA, the LLM reading the SRT is usually sufficient. Use these if you need fully automated processing:

### Volume Spikes (sox)
```bash
for t in $(seq 0 10 "$DURATION"); do
  sox "$WORKDIR/audio.wav" -n trim "$t" 10 stat 2>&1 | \
    grep "RMS.*amplitude" >> "$WORKDIR/volume-profile.txt"
done
# Spike threshold: RMS > 1.2x average for QA narration (1.3x for Twitch)
```

### Silence Boundary Detection
```bash
ffmpeg -i "$WORKDIR/audio.wav" -af silencedetect=noise=-30dB:d=1.5 -f null - 2>&1 | \
  grep "silence_" > "$WORKDIR/silence-boundaries.txt"
```

### Screen Change Detection
```bash
# Extract reference frames
for t in $(seq 0 5 "$DURATION"); do
  ffmpeg -ss "$t" -i "$VIDEO" -vframes 1 -q:v 2 "$WORKDIR/frames/every5s-${t}s.jpg" 2>/dev/null
done

# Compare consecutive frames for big visual changes
# Large diff = page navigation, modal open, error appearing
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| whisper-cli not found | `brew install whisper-cpp` or build from source |
| No ggml-small.bin | `whisper-cli --download-model small` |
| ffmpeg exit code 234 | Retry with background execution: `ffmpeg ... &` then `wait` |
| Empty transcript | Check audio quality: `ffplay "$WORKDIR/audio.wav"` |
| Whisper garbled output | Try medium or large model, or check `-l` language flag |
