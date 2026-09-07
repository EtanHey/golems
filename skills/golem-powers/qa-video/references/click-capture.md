# Click Capture — CGEventTap Logger + Three-Stream Correlation

> Closes the 2-5 second gap between clicking and narrating by logging clicks with millisecond precision.

## The Problem

Users click UI elements BEFORE narrating what they did. Speech timestamps lag behind action timestamps by 2-5 seconds. Without click data, frame extraction relies on speech hotspots alone, which show the RESULT of an action, not the moment of clicking.

## Solution: Three-Stream Correlation

| Stream | Source | Format | Time reference |
|--------|--------|--------|----------------|
| Clicks | `qa_click_logger.py` | JSONL (epoch ms) | Wall clock |
| Transcript | whisper-cli | SRT (video-relative seconds) | Video start |
| Frames | screen recording | .mov (PTS from 0) | Video start |

**Alignment:** Extract video creation_time via `ffprobe`, convert click epoch_ms to video-relative seconds. Now all three streams share the same reference.

## Click Logger

**Script:** `$ORCHESTRATOR_REPO/scripts/qa/qa_click_logger.py`

**What it captures:**
```json
{
  "timestamp_ms": 1711234567890,
  "x": 512,
  "y": 340,
  "event": "left_click",
  "element_role": "AXButton",
  "element_title": "Submit",
  "app": "Brave Browser"
}
```

**How it works:**
- Python CGEventTap with `.listenOnly` mode (passive, no interference)
- Captures left + right clicks system-wide
- Gets accessibility info via `AXUIElementCopyElementAtPosition`
- Gets frontmost app name
- Logs to `clicks.jsonl` in real-time

**Permissions (one-time setup):**
- System Settings → Privacy & Security → **Input Monitoring** → grant Terminal/iTerm
- System Settings → Privacy & Security → **Accessibility** → grant Terminal/iTerm

**Install dependencies:**
```bash
pip3 install pyobjc-framework-Quartz pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa
```

**Run:**
```bash
ORCHESTRATOR_REPO="${ORCHESTRATOR_REPO:-$HOME/Gits/orchestrator}"
python3 "$ORCHESTRATOR_REPO/scripts/qa/qa_click_logger.py" /path/to/session-dir/
# → writes to /path/to/session-dir/clicks.jsonl
# Ctrl+C to stop
```

## Session Starter (qa-record.sh)

**Script:** `$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh`

One command to start everything:
```bash
ORCHESTRATOR_REPO="${ORCHESTRATOR_REPO:-$HOME/Gits/orchestrator}"
bash "$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh" "$HOME/Gits/<project>/docs/"
```

This:
1. Creates `qa-session-YYYY-MM-DD-HHMM/` directory
2. Starts click logger in background
3. Opens macOS screen recording UI (Cmd+Shift+5)
4. On Ctrl+C: stops logger, reports file locations

## Three-Stream Correlation (Processing)

### Step 1: Get common time reference
```bash
# Video creation time
ffprobe -v quiet -show_entries format_tags=creation_time \
  -of default=noprint_wrappers=1:nokey=1 recording.mov
# → 2026-03-23T10:30:00.000000Z
```

### Step 2: Convert clicks to video-relative seconds
```python
from datetime import datetime, timezone

video_start = datetime.fromisoformat("2026-03-23T10:30:00+00:00")
video_start_ms = int(video_start.timestamp() * 1000)

# For each click:
video_offset_sec = (click["timestamp_ms"] - video_start_ms) / 1000.0
```

### Step 3: 7-second forward window (click → narration matching)
```python
def match_click_to_narration(click_time, whisper_segments, window=7.0):
    """User clicks at time t, narrates 2-5s later.
    Search for transcript segments starting between t and t+7s."""
    return [seg for seg in whisper_segments
            if click_time <= seg["start"] <= click_time + window]
```

**Adaptive offset:** Compute median delay across confirmed click-narration pairs in the session, use as expected offset for ambiguous matches.

### Step 4: Extract frame at click time
```bash
# Frame at the moment of clicking (BEFORE the UI changes)
ffmpeg -ss 15.200 -i recording.mov -frames:v 1 -q:v 2 click_frame_15200.jpg
```

## Browser Extension (Optional — Richer DOM Context)

The OS logger captures coordinates + accessibility roles. A browser extension adds:
- CSS selectors
- React component names (via `__reactFiber$`)
- Element text content
- ARIA attributes
- Current URL

Only enable browser-extension capture with the user's explicit consent and on
approved, non-sensitive test data. Before sharing or persisting `clicks.jsonl`,
redact element text, URLs, query strings, and any captured account/customer
data. Keep raw click logs only for the active QA session, then delete them once
the redacted findings and required evidence frames have been accepted.

The optional browser-extension implementation is intentionally maintained
outside this public skill package. Keep the consent and redaction rules above
when integrating one.

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│  QA SESSION                                      │
│                                                  │
│  Screen Recording      Click Logger (background) │
│  → video.mov           → clicks.jsonl            │
└────────────────────────────────────────────────-─┘
                         │
                         ▼
┌─────────────────────────────────────────────────┐
│  PROCESSING                                      │
│                                                  │
│  video.mov → ffprobe (creation_time)             │
│           → whisper-cli → transcript.srt         │
│                                                  │
│  clicks.jsonl → convert to video-relative sec    │
│              → correlate with transcript (7s)    │
│              → extract frames at click times     │
│                                                  │
│  Result: click metadata + narration + frame      │
│          = structured QA finding                 │
└─────────────────────────────────────────────────┘
```
