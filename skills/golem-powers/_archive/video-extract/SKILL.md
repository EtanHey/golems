---
name: video-extract
description: Extract structured knowledge from any video source — YouTube URLs or local screen recordings. YouTube → gems workflow (yt-dlp transcript → keyword hotspots → frame extract → brain_digest → structured gems). Screen recordings → QA workflow (reuses /qa-video stalker pipeline). Use when user shares a YouTube link wanting deep extraction with frames, shares a .mov/.mp4 for QA processing, says "extract from video", "video gems", "process this recording", or mentions gem extraction from video content.
execute: scripts/default.sh
---

# /video-extract — Video Knowledge Extraction

> Two workflows, one entry point. YouTube URLs get the **gems** pipeline (deep extraction with frames and keyword hotspots). Screen recordings get the **QA** pipeline (stalker-based structured findings).

## How It Works

```
Input Detection
  ├── YouTube URL (https://youtube.com/..., youtu.be/...)
  │     → GEMS workflow
  │       → yt-dlp (audio + metadata)
  │         → whisper-cli transcription (SRT + TXT)
  │           → LLM keyword hotspot detection
  │             → yt-dlp frame extraction at hotspot timestamps
  │               → Claude Vision reads frames + transcript context
  │                 → brain_digest (full content)
  │                   → brain_store (structured gems)
  │
  └── Local recording (.mov, .mp4, .mkv)
        → QA workflow (delegates to /qa-video)
          → ffmpeg audio extraction
            → whisper-cli transcription
              → hotspot detection + frame extraction
                → Claude Vision analysis
                  → Structured QA findings
```

---

## Workflow Detection & Routing

Read the user's input and route:

| Input pattern | Route to |
|---------------|----------|
| YouTube URL (`youtube.com`, `youtu.be`, `yt.be`) | [workflows/gems.md](workflows/gems.md) — Deep extraction with keyword hotspots + frames |
| Local video path (`.mov`, `.mp4`, `.mkv`, `.webm`) | [workflows/qa.md](workflows/qa.md) — Delegates to /qa-video stalker pipeline. BrainLayer storage still applies — verify after /qa-video returns. |
| "extract gems from [video]" | Gems workflow (even for local files if user wants gems, not QA) |
| "process QA recording", "QA round" | QA workflow (even for YouTube if it's a recorded QA session) |
| Ambiguous | Ask: "Is this a YouTube video you want gems from, or a QA recording you want processed?" |

**Override signals:** If the user says "gems" or "insights" or "takeaways", use gems workflow regardless of source. If they say "QA", "bugs", "findings", use QA workflow regardless of source.

---

## 🚨 BrainLayer Protocol (MANDATORY)

Both workflows store results in BrainLayer. If BrainLayer is unavailable at ANY point:

```
🚨🚨🚨 BRAINLAYER UNAVAILABLE — [brain_store/brain_digest] failed.
Gems/findings NOT persisted. Raw output saved to [local path].
Fix: Check BrainLayer MCP connection. Retry: brain_store(content, tags, importance).
🚨🚨🚨
```

**NEVER silently skip BrainLayer storage.** NEVER say "I'll store it later." NEVER proceed without flagging. The whole point of this skill is durable knowledge extraction — without BrainLayer, the knowledge is lost.

**Fallback:** If BrainLayer is down, write the full output to `docs.local/video-extract/[date]-[title].md` so it can be manually digested later. But still flag loudly.

---

## Prerequisites

| Tool | Check | Install | Used by |
|------|-------|---------|---------|
| yt-dlp | `which yt-dlp` | `pip3 install yt-dlp` | Gems (YouTube download) |
| ffmpeg | `which ffmpeg` | `brew install ffmpeg` | Both (audio extraction, frame extraction) |
| whisper-cli | `which whisper-cli` | `brew install whisper-cpp` | Both (transcription) |
| whisper model | `ls ~/.cache/whisper/ggml-small.bin` | `whisper-cli --download-model small` | Both |

**Optional:** `exa` MCP (fallback transcript source for YouTube if yt-dlp fails)

---

## Quick Reference

**YouTube gems:**
```bash
# The skill handles this — just give it a URL
/video-extract https://www.youtube.com/watch?v=VIDEO_ID
```

**QA recording:**
```bash
# Give it a path to your screen recording
/video-extract ~/Desktop/recording.mov
```

---

## Key Design Decisions

1. **Hybrid approach: exa scout → yt-dlp deep** — Tested on real video (Chase AI GSD2, 15min). Exa-only found 5 gems in 5 seconds. Full yt-dlp→whisper→frames found 12 gems in 4 minutes (2.4x). Exa missed all hard data ($30 cost, timing comparisons), war stories, and visual evidence. **Use exa first as a scout** ("is this video worth deep extraction?"). **Use full pipeline for high-value videos** where durable knowledge matters. For batch processing (5+ videos), scout all with exa, then full-pipeline the top picks.

2. **Keyword hotspot detection** — LLM reads the transcript and identifies "gem moments" — surprising insights, strong opinions, technical revelations, actionable advice. Different from QA hotspots (which look for bugs/issues).

3. **Frame extraction from YouTube** — yt-dlp can download video, then ffmpeg extracts frames at gem timestamps. The visual context (slides, code, diagrams) makes gems 3x more useful than transcript-only.

4. **Two workflows, shared tooling** — Both use ffmpeg + whisper-cli. The difference is in the analysis: gems workflow looks for insights/knowledge, QA workflow looks for bugs/issues.

5. **BrainLayer is the destination, not files** — Files are intermediate artifacts. The durable output is in BrainLayer. Local files can be cleaned up after brain_digest succeeds.
