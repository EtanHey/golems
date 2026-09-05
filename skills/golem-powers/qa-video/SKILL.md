---
name: qa-video
description: "Video QA/extraction for screen, local video, YouTube. Triggers: narrated QA, bugs, QA checklist, video gems."
execute: scripts/default.sh
---

# /qa-video — Video-Based QA + Gems Pipeline

> Record your screen while narrating, or provide a YouTube/local video for knowledge extraction. The pipeline extracts speech, pulls visual context, and produces either structured QA findings or durable gems.

## How It Works

```
Screen Recording (.mov)
  → ffmpeg audio extraction
    → whisper-cli transcription (SRT + TXT)
      → LLM reads SRT, identifies QA-relevant segments
        → Frame extraction at hotspot timestamps + regular intervals
          → Claude Vision reads frames + correlates with transcript
            → Structured QA findings document
              → Agent handoff (Codex/Claude worker via cmux)

YouTube / gems request
  → yt-dlp audio + metadata
    → whisper-cli transcription (SRT + TXT)
      → keyword hotspot detection for insights, claims, data, and examples
        → yt-dlp/ffmpeg frame extraction at hotspot timestamps
          → vision pass over frames + transcript context
            → brain_digest full content
              → brain_store structured gems
```

## The Cardinal Rule: Narrate Before You Act

**Tell the user BEFORE every QA recording session:**

> Narrate your intentions BEFORE clicking. Say "I'm about to click Spin Rare on Sarah" → click → describe what happened. This aligns speech timestamps with actions, making the pipeline 3x more accurate at identifying what you were pointing at.

The 2-5 second gap between clicking and narrating is the #1 accuracy killer. Coaching the user to narrate-first is more impactful than any technical fix.

---

## Workflow Detection & Routing

Read the user's request and route to the right workflow:

| User says | Route to |
|-----------|----------|
| "let's do QA", "test this", "QA round" | [workflows/record.md](workflows/record.md) — Pre-QA checklist + recording setup |
| "process this video", "I recorded QA", path to .mov file | [workflows/process.md](workflows/process.md) — Stalker pipeline processing |
| "send fixes to Codex", "hand off findings" | [workflows/handoff.md](workflows/handoff.md) — Agent handoff pattern |
| "next round", "retest", "QA round N" | [workflows/iterate.md](workflows/iterate.md) — Multi-round QA cycle |
| "set up click capture", "qa-record" | [references/click-capture.md](references/click-capture.md) — CGEventTap + qa-record.sh |
| YouTube URL, "video gems", "extract from video", "insights/takeaways from this video" | [workflows/gems.md](workflows/gems.md) — YouTube/local-video knowledge extraction with transcript + frames |

**Override signals:** If the user says "gems", "insights", or "takeaways", use the gems workflow regardless of source. If they say "QA", "bugs", or "findings", use the QA workflow regardless of source.

**If ambiguous:** Ask whether this is a QA recording to process or a video to extract gems from.

**Subagent routing (delegated jobs):** When a video QA/extraction job is delegated to a subagent, it MUST be the dedicated pipeline subagent (`subagent_type: video-gems` / video-extract — whisper transcription + hotspot finding + 100–250ms frame extraction). Spawning a general-purpose agent and telling it to "use the qa-video skill" is a **routing violation** — TaskStop it and respawn with the proper pipeline subagent. Same class as the batch-session-miners rule: dedicated pipeline subagent, never a general-purpose stand-in.

**Verdict integrity (before emitting a QA verdict or "QA complete"):** Run `/qa-verdict-gate` over the run. It enforces tri-state **PASS / FAIL / INCONCLUSIVE** — `FAIL` is reserved for a *confirmed-observed* failure (a screenshot/click that reached the surface or an observed error in a tool result); a path you **couldn't reach** ("couldn't load", "element not found", blocked at step 0) is `INCONCLUSIVE`, never FAIL or PASS — and a QA run only counts when a `qa-report.md` with all the checklist items exists. `bun skills/golem-powers/qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs <transcript|->` (exit 3 = FLAG = the verdict isn't earned yet). Composes with `/false-green-gate` and `/never-fabricate`.

---

## Key Design Decisions (learned from real usage)

1. **LLM reads the SRT directly** — no automated hotspot detection (sox/ImageMagick). Claude reading the transcript is a better hotspot detector than volume spikes or frame diffs. The automated signals (from the original Twitch stalker pipeline) are unnecessary for QA narration.

2. **Regular interval + hotspot frames** — Extract one frame every 30 seconds for full visual coverage, PLUS frames at each identified hotspot. Hotspot-only extraction misses visual bugs described after the fact.

3. **Before/after context frames** — At each hotspot, extract frames at -5s and +5s in addition to the hotspot timestamp. The user may explain an issue THEN show it, or show it THEN explain.

4. **Whisper model: `ggml-small`** — Fast on Apple Silicon (~14s for 7min video), accurate enough for English QA narration. The `ggml-large-v3` is better but 5x slower — not worth it for QA.

5. **Findings live in the PROJECT repo** — `docs/qa-session-YYYY-MM-DD/` in the project being tested, not in the orchestrator. Each round gets a suffix: `qa-findings-round2.md`.

6. **BrainLayer storage is mandatory** — After every video processing run, `brain_store` the findings summary with tags `["qa", "<project>", "round-N"]`.

7. **QA is iterative** — Expect 3-6 rounds per feature. The skill supports multi-round workflows with proper round numbering and delta tracking (what was fixed vs. what persists).

8. **Gems use the same media primitives with a different analysis target** — QA hotspots look for bugs and UX issues. Gems hotspots look for surprising insights, strong opinions, technical revelations, numbers, examples, and reusable advice.

9. **BrainLayer is the destination for gems** — Files are intermediate artifacts. Use `brain_digest` for full transcripts/notes, then `brain_store` the structured gems. If BrainLayer is unavailable, write the full output to `docs.local/qa-video/[date]-[title].md` and flag that persistence failed.

10. **Gemini handles visual-heavy frame batches** — Per `/agent-routing`, use Gemini for bulk frame/OCR/visual reads. Claude wraps up with synthesis, `brain_digest`, `brain_store`, ledger updates, and Drive archival.

---

## Prerequisites

| Tool | Check | Install |
|------|-------|---------|
| ffmpeg | `which ffmpeg` | `brew install ffmpeg` |
| whisper-cli | `which whisper-cli` | `brew install whisper-cpp` |
| whisper model | `ls ~/.cache/whisper/ggml-small.bin` | `whisper-cli --download-model small` |
| yt-dlp | `which yt-dlp` | `pip3 install yt-dlp` |

**Optional (click capture — Phase 2):**

| Tool | Check | Install |
|------|-------|---------|
| pyobjc | `python3 -c "import Quartz"` | `pip3 install pyobjc-framework-Quartz pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa` |
| qa_click_logger.py | `ls "$ORCHESTRATOR_REPO/scripts/qa/qa_click_logger.py"` | Already exists in orchestrator repo |
| qa-record.sh | `ls "$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh"` | Already exists in orchestrator repo |

---

## Quick Reference

**Start a recording session:**
```bash
# With click capture (recommended):
: "${ORCHESTRATOR_REPO:?ORCHESTRATOR_REPO must be set}"
bash "$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh" ~/Gits/<project>/docs/

# Manual (just screen recording):
# Cmd+Shift+5 → Record Selected Portion → narrate while testing
```

**Process a video:**
```bash
VIDEO="/path/to/recording.mov"
WORKDIR="~/Gits/<project>/docs/qa-session-$(date +%Y-%m-%d)"
mkdir -p "$WORKDIR/frames"

# 1. Extract audio
ffmpeg -i "$VIDEO" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$WORKDIR/audio.wav"

# 2. Transcribe
whisper-cli -m ~/.cache/whisper/ggml-small.bin -f "$WORKDIR/audio.wav" \
  --output-srt --output-txt -of "$WORKDIR/transcript" -l auto

# 3. Read transcript.srt → identify hotspot timestamps
# 4. Extract frames (hotspots + every 30s)
# 5. Read frames with Claude Vision
# 6. Compile findings doc
```

**For the full step-by-step, load [workflows/process.md](workflows/process.md).**

**Extract YouTube gems:**
```bash
# Give /qa-video the URL and load workflows/gems.md
/qa-video https://www.youtube.com/watch?v=VIDEO_ID
```
