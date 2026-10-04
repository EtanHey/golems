---
name: qa-video
description: "Video QA/extraction for screen, local video, YouTube. Triggers: narrated QA, bugs, QA checklist, video gems."
execute: scripts/default.sh
---

# /qa-video — Video-Based QA + Gems Pipeline

> Record your screen while narrating, or provide a YouTube/local video for knowledge extraction. The pipeline extracts speech, pulls visual context, and produces either structured QA findings or durable gems.

## How It Works

```
Screen recording / local video / YouTube video (downloaded by dispatcher)
  → Dispatcher background Bash: prepare.sh --mode qa|gems
    → ffmpeg audio + whisper-cli SRT/TXT
      → transcript/scene cues + dense contact sheets + 30s coverage frames
        → manifest.json ready: true
          → visual-gatherer (Agent) / gemini.gather.visual (cmux) reads every sheet
            → Claude synthesizes QA findings or gems
              → BrainLayer persistence + requested handoff / archival
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

**Subagent routing (delegated jobs):** The dispatcher owns all deterministic media preparation: run `scripts/prepare.sh` in its own background Bash (`run_in_background`), wait for that task to succeed, and read `manifest.json` to verify `ready: true` before delegating reading. In an Agent-tool context use `Agent(visual-gatherer)` (golems#553) over the manifest's sheets and transcript. In a cmux lane use the `gemini.gather.visual` gatherer pane with the restricted reader brief in rule 10. The reader never prepares media or controls terminals.

**Verdict integrity (before emitting a QA verdict or "QA complete"):** Run `/qa-verdict-gate` over the run. It enforces tri-state **PASS / FAIL / INCONCLUSIVE** — `FAIL` is reserved for a *confirmed-observed* failure (a screenshot/click that reached the surface or an observed error in a tool result); a path you **couldn't reach** ("couldn't load", "element not found", blocked at step 0) is `INCONCLUSIVE`, never FAIL or PASS — and a QA run only counts when a `qa-report.md` with all the checklist items exists. `bun skills/golem-powers/qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs <transcript|->` (exit 3 = FLAG = the verdict isn't earned yet). Composes with `/false-green-gate` and `/never-fabricate`.

---

## Key Design Decisions (learned from real usage)

1. **LLM reads the SRT directly** — no automated hotspot detection (sox/ImageMagick). Claude reading the transcript is a better hotspot detector than volume spikes or frame diffs. The automated signals (from the original Twitch stalker pipeline) are unnecessary for QA narration.

2. **Dense action windows (mandatory)** — In QA mode, every action cue gets a dense-frame window, not a single frame. A click's target, hover state and resulting animation all happen in under a second; one frame every 30s plus ±5s hotspot frames cannot show what was clicked or how the UI reacted, and a 10-run eval found every "pixel-only" finding from that method was hallucinated or mis-scoped.
   - **Build `cues.tsv`** (`start_s<TAB>end_s<TAB>label`) from:
     - (a) every transcript segment whose text matches action language: click, clicking, press, tap, hover, drag, drop, scroll, open, close, select, toggle, switch, type, "when I", "now I", "this", "here", "look", "watch"
     - (b) `scripts/scene-cues.sh <video>` output — visual changes catch silent clicks and UI changes the narrator never mentions
     - (c) click logs, if `qa_click_logger` data exists for the session
   - **Run `scripts/dense-windows.sh <video> cues.tsv <outdir> [fps] [pre] [post]`** at 10 fps by default (5–20 allowed; use 20 fps for animations). It merges overlapping `[start-1.0s, end+2.0s]` windows, tiles frames into 5x4 contact sheets, and writes `index.tsv` (`sheet_file<TAB>window_start_s<TAB>fps<TAB>tiles<TAB>label`) plus `frames.tsv` (`sheet_file<TAB>tile<TAB>t_s`). Times are the extracted frames' real PTS, so `window_start_s` can be later than the padded cue start; tile *i* (row-major, 0-based) is at `window_start_s + i/fps`, and `frames.tsv` is exact.
   - **Read EVERY contact sheet, in order.** For each window, state: what the cursor targets, the before/after UI state, and any visual defect.
   - **Cite or label.** A visual finding must cite `sheet + tile index → timestamp` (e.g. `sheet_004.jpg tile 7 → 12.7s`). A finding with no sheet citation is transcript-only and must be labelled **transcript-only**.

3. **Interval frames are a coverage pass only** — Still extract one frame every 30 seconds so nothing between cues goes unseen, but never base a visual finding on an interval frame alone; if one shows something, add a cue there and re-run `dense-windows.sh`.

4. **Whisper model: `ggml-small`** — Fast on Apple Silicon (~14s for 7min video), accurate enough for English QA narration. The `ggml-large-v3` is better but 5x slower — not worth it for QA.

5. **Findings live in the PROJECT repo** — `docs/qa-session-YYYY-MM-DD-HHMM/` in the project being tested, not in the orchestrator. Each round gets a suffix: `qa-findings-round2.md`.

6. **BrainLayer storage is mandatory** — After every video processing run, `brain_store` the findings summary with tags `["qa", "<project>", "round-N"]`.

7. **QA is iterative** — Expect 3-6 rounds per feature. The skill supports multi-round workflows with proper round numbering and delta tracking (what was fixed vs. what persists).

8. **Gems use the same media primitives with a different analysis target** — QA hotspots look for bugs and UX issues. Gems hotspots look for surprising insights, strong opinions, technical revelations, numbers, examples, and reusable advice.

9. **BrainLayer is the destination for gems** — Files are intermediate artifacts. Use `brain_digest` for full transcripts/notes, then `brain_store` the structured gems. If BrainLayer is unavailable, write the full output to `docs.local/qa-video/[date]-[title].md` and flag that persistence failed.

10. **Dispatcher prepares; gatherer reads** — The dispatcher runs `scripts/prepare.sh <video> <workdir> [--fps N] [--mode qa|gems]` in its own background Bash (`run_in_background`). Wait for successful task completion and `manifest.json` with `ready: true`; a missing manifest or failed task blocks handoff. Agent-tool contexts use `Agent(visual-gatherer)` (golems#553). cmux lanes use the **`gemini.gather.visual` gatherer** (`{repo}Gemini -m $(node scripts/model-roles.mjs gemini.gather.visual --field launcher_tier)`, resolved from the golems checkout). Its brief must say: "Read manifest.json and the listed sheets/transcript only; never spawn panes, never send_to terminals, never run media tools." Read every sheet in manifest order and preserve sheet/tile evidence. Claude owns synthesis, `brain_digest`, `brain_store`, ledger updates, and Drive archival.

---

## Prerequisites

| Tool | Check | Install |
|------|-------|---------|
| ffmpeg + ffprobe | `which ffmpeg ffprobe` | `brew install ffmpeg` |
| Python 3 | `which python3` | `brew install python` |
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
WORKDIR="$HOME/Gits/<project>/docs/qa-session-$(date +%Y-%m-%d-%H%M)"
SCRIPTS="<qa-video skill dir>/scripts"
# Dispatcher Bash tool: run_in_background: true
bash "$SCRIPTS/prepare.sh" "$VIDEO" "$WORKDIR" --fps 10 --mode qa
# Wait for the background task; verify manifest.json ready: true, then hand its
# absolute contact_sheets/transcript paths to the restricted visual reader.
# Compile findings with sheet + tile -> timestamp citations from frames.tsv.
```

**For the full step-by-step, load [workflows/process.md](workflows/process.md).**

**Extract YouTube gems:**
```bash
# Give /qa-video the URL and load workflows/gems.md
/qa-video https://www.youtube.com/watch?v=VIDEO_ID
```
