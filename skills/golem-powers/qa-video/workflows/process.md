# Stalker Pipeline: Video → Structured QA Findings

## Inputs Required
- `VIDEO` — path to the .mov screen recording
- `PROJECT_ROOT` — project repo receiving the QA session artifacts
- `WORKDIR` — optional existing session directory containing the recording and click log; defaults to a new timestamped directory under `$PROJECT_ROOT/docs/`
- `ROUND` — round number for multi-round QA (default: 1)

See [stalker-pipeline.md](../references/stalker-pipeline.md) for the full media
command reference and troubleshooting notes.

## Phase 1: Audio Extraction + Transcription

```bash
VIDEO="/path/to/recording.mov"
: "${PROJECT_ROOT:?set PROJECT_ROOT to the project repo being tested}"
WORKDIR="${WORKDIR:-$PROJECT_ROOT/docs/qa-session-$(date +%Y-%m-%d-%H%M)}"
ROUND=1

# Create directory structure
mkdir -p "$WORKDIR/frames"
[ "$ROUND" -gt 1 ] && mkdir -p "$WORKDIR/frames-round${ROUND}"

# Suffix for multi-round support
SUFFIX=""
[ "$ROUND" -gt 1 ] && SUFFIX="-round${ROUND}"

# 1. Extract audio
ffmpeg -i "$VIDEO" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$WORKDIR/audio${SUFFIX}.wav"

# 2. Transcribe with whisper-cli
whisper-cli -m "$HOME/.cache/whisper/ggml-small.bin" \
  -f "$WORKDIR/audio${SUFFIX}.wav" \
  --output-srt --output-txt \
  -of "$WORKDIR/transcript${SUFFIX}" \
  -l auto
# Outputs: transcript.srt (timestamps) + transcript.txt (plain)
```

**Verify:** Read `transcript.srt` — confirm it has content and timestamps look reasonable. If whisper-cli fails, try `mlx_whisper` as fallback.

## Phase 2: Transcript Analysis (LLM Hotspot Detection)

**Read the SRT file.** Identify QA-relevant segments by content:

| Signal | Examples |
|--------|----------|
| **Bug** | "broken", "doesn't work", "wrong", "should be", "expected", "still broken" |
| **UX** | "confusing", "can't find", "hard to", "ugly", "too small", "not clear" |
| **Feature** | "should have", "would be nice", "need to add", "missing" |
| **Positive** | "works", "good", "nice", "perfect" |
| **Recurring** | "again", "still", "same bug", "didn't fix" — flag these as CRITICAL |

For each relevant segment, note the **start timestamp** (seconds from video start).

**Also extract:** Video duration from the SRT's last timestamp or via:
```bash
ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO"
```

## Phase 3: Frame Extraction

Extract TWO types of frames:

### 3a. Regular Interval Frames (every 30 seconds)
```bash
DURATION=$(ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO" | cut -d. -f1)
FRAMEDIR="$WORKDIR/frames${SUFFIX:+"-round${ROUND}"}"

if [[ ! "$DURATION" =~ ^[0-9]+$ ]] || [ "$DURATION" -le 0 ]; then
  printf 'Could not determine a positive video duration: %s\n' "$DURATION" >&2
  exit 1
fi

for t in $(seq 0 30 "$DURATION"); do
  INTERVAL_TIMESTAMP="$t"
  ffmpeg -ss "$INTERVAL_TIMESTAMP" -i "$VIDEO" -vframes 1 -q:v 2 "$FRAMEDIR/interval-${INTERVAL_TIMESTAMP}s.jpg" 2>/dev/null
done
```

### 3b. Hotspot Frames (with context)
For each identified hotspot timestamp:
```bash
# Example: hotspot at 154 seconds
HOTSPOT=154
BEFORE=$((HOTSPOT - 5))
[ "$BEFORE" -lt 0 ] && BEFORE=0
AT="$HOTSPOT"
AFTER=$((HOTSPOT + 5))
ffmpeg -ss "$BEFORE" -i "$VIDEO" -vframes 1 -q:v 2 "$FRAMEDIR/hotspot-${HOTSPOT}s-before5s.jpg" 2>/dev/null
ffmpeg -ss "$AT"     -i "$VIDEO" -vframes 1 -q:v 2 "$FRAMEDIR/hotspot-${HOTSPOT}s-at.jpg" 2>/dev/null
ffmpeg -ss "$AFTER"  -i "$VIDEO" -vframes 1 -q:v 2 "$FRAMEDIR/hotspot-${HOTSPOT}s-after5s.jpg" 2>/dev/null
```

**Why both:** Regular intervals catch visual bugs described after the fact. Hotspot frames catch the exact moment + context. Together they provide full coverage.

**Two-pass frame extraction (learned from real usage):** In practice, the first pass extracts frames at ALL identified hotspot timestamps (may be 20-30). After reading a subset of frames, you'll identify which are redundant. The second pass refines — deduplicate similar timestamps and extract only the most informative set. Don't try to perfectly select timestamps upfront.

**If ffmpeg fails with exit code 234:** Retry with background execution:
```bash
# Re-run the exact failed command in the background, preserving its established
# timestamp and output filename. Choose the matching command; do not invent a
# third filename pattern.

# Regular interval retry:
ffmpeg -ss "$INTERVAL_TIMESTAMP" -i "$VIDEO" -vframes 1 -q:v 2 \
  "$FRAMEDIR/interval-${INTERVAL_TIMESTAMP}s.jpg" 2>/dev/null &

# Hotspot-at retry (for a failed before/after frame, preserve that command's
# BEFORE/AFTER timestamp and before5s/after5s filename instead):
ffmpeg -ss "$AT" -i "$VIDEO" -vframes 1 -q:v 2 \
  "$FRAMEDIR/hotspot-${HOTSPOT}s-at.jpg" 2>/dev/null &
```
Wait for the selected retry, then verify its expected file exists and is not
empty.

### 3c. Click Correlation (when `clicks.jsonl` exists)

Follow [click-capture.md](../references/click-capture.md) to convert click wall
clock timestamps into video-relative seconds, match each click to narration in
the seven-second forward window, and extract a frame at the click timestamp.
Treat the click log as sensitive: obtain explicit consent, use approved test
data, redact captured text and URLs before sharing, and delete the raw log after
the redacted findings and evidence frames are accepted.

## Phase 4: Claude Vision Analysis

**Read the extracted frames** (they're images — use the Read tool). You don't need to read ALL frames — read 8-12 strategically chosen ones. In real sessions, Claude read 10 frames for a 7-min video and only 4 for a 21-min video (more targeted second time).

For each frame:

1. What page/component is showing?
2. Is there a visible bug, error message, or unexpected state?
3. Does the screen match what the user was describing at this timestamp?
4. Any UI issues not mentioned in narration (layout, alignment, contrast, responsiveness)?

**Correlate** each frame with the corresponding SRT segment. The key advantage: you get BOTH what the user SAID and what they SAW, aligned by timestamp.

## Phase 5: Compile QA Findings Document

Write to `$WORKDIR/qa-findings${SUFFIX}.md`:

```markdown
# QA Session [Round N] — [Project] — YYYY-MM-DD

## Summary
- **Duration:** M:SS
- **Hotspots found:** N
- **Critical issues:** N
- **Major issues:** N
- **Minor/UX issues:** N
- **Enhancements:** N

---

## Finding 1: [Short descriptive title]
- **Timestamp:** M:SS–M:SS
- **Severity:** Critical / Major / Minor / UX / Enhancement
- **What was said:** "[exact transcript quote]"
- **What's on screen:** [describe the frame — page, state, visible elements]
- **Frame:** frames/hotspot-154s-at.jpg
- **Action needed:** [specific fix or investigation]
- **Recurring?:** Yes/No (if seen in previous rounds, note which)

---

[repeat for each finding]

---

## QA Verdict
**[One paragraph summary]** — what's the #1 blocker? What's demo-ready? What needs another round?

## Recurring Issues (across rounds)
[List any bugs that appeared in multiple rounds — these need root-cause investigation, not just symptom fixes]
```

**Severity guide:**
- **Critical** — Blocking bug, broken core flow, data loss
- **Major** — Significant functional issue, wrong behavior
- **Minor** — Label mismatch, small inconsistency, polish
- **UX** — Not a bug but confusing, ugly, or hard to use
- **Enhancement** — Feature idea, future improvement

## Phase 6: Store in BrainLayer

```
brain_store(
  content: "QA Round N — [Project]: [X] findings ([Y] critical, [Z] major). Key issues: [list top 3]. Recurring: [list any]. Findings doc: [path]",
  tags: ["qa", "<project>", "round-N", "qa-findings"],
  importance: 7
)
```

## After Processing

Tell the user what you found — top-line summary + ask if they want to hand off to an implementing agent.
Route to [workflows/handoff.md](handoff.md) if yes.
