---
name: qa-video
description: "Video QA/extraction for screen, local video, YouTube. Triggers: narrated QA, bugs, QA checklist, video gems."
execute: scripts/default.sh
---

# /qa-video — Video-Based QA + Gems Pipeline

> Record your screen while narrating, or provide a YouTube/local video for knowledge extraction. The pipeline extracts speech, pulls visual context, and produces either structured QA findings or durable gems.

## How It Works

```
Local recording / YouTube video (downloaded in the agent's own shell)
  → extract.sh: ffmpeg audio + whisper-cli SRT/TXT
    → Agent selects transcript hotspots + scene-cues.sh visual changes
      → dense-windows.sh: 10 fps contact sheets + 30s coverage
        → Pipeline calls visual-gather.py for EVERY sheet
          → Unclear? Re-densify at up to 20 fps / tighter windows and re-read
            → Resolved or NOT DETERMINED, with sheet/tile/timestamp evidence
              → QA findings or gems, BrainLayer persistence, requested handoff
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

**Execution routing — ONE route per request:**

| Request | Execution owner | Image reader |
|---|---|---|
| QA a recording (default) | `Agent(qa-video-runner)` with video, project, artifact directory and round | `visual-gather.py` called directly from its Bash |
| Extract gems (default) | `Agent(video-gems)` with source and artifact directory | `visual-gather.py` called directly from its Bash |
| Etan explicitly asks for a visible worker | Lead opens a cmux Gemini worker with `agy --agent video-qa` and an explicit absolute `docs.local` workdir | That worker views sheets and runs the same iterative loop |

**Subagent routing:** Dispatch the full pipeline once using this table. Do not
open an unrequested Gemini pane or run the default pipeline in the lead.
`qa-video-runner` is packaged in `agents/qa-video-runner.md`; install/link it into
Claude's agent directory before dispatch using `orc/scripts/install.sh`
(the existing installer discovers qa-video agents). `video-gems` currently lives in
`~/.claude/agents/video-gems.md`; its packaging/helper update is a lead follow-up.
If that local agent lacks the helper contract, include this workflow in its brief.

Default pipeline: `Agent(qa-video-runner)` for QA, `Agent(video-gems)` for gems.
The pipeline sub-agent owns the whole iterative loop in its **own shell**;
never read images in the lead or pipeline sub-agent. Read text with Read;
call `scripts/visual-gather.py` directly from Bash for every sheet/frame.
A sub-agent cannot dispatch another sub-agent: never use the Agent tool from
inside the pipeline. The parent may use `Agent(visual-gatherer)` for ad-hoc
screenshot questions outside this pipeline.

Only when Etan **explicitly** asks for a **visible worker**, the lead opens a
Gemini worker using `agy --agent video-qa` (golems#563). That worker owns the
same loop in its own shell and may view images itself. Its profile permits
artifacts only in the assigned `docs.local` directory or engine report path;
pass that absolute workdir explicitly. For QA, the parent persists the final note and
cited evidence under the project `docs/` directory before BrainLayer storage.
**Never open a terminal pane**
or type into another surface to run media tools; never `send_to` media commands.
If the selected profile has no shell, stop and ask the lead for the shell-enabled
pipeline profile (or `video-qa` for the explicitly requested visible route).

Long jobs use `run-step.sh <artifact-dir> <step> -- <command> [args...]`:
`logs/<step>.log`, `<step>.pid`, `<step>.exit` all live under the artifact directory's
`logs/`. Poll `.exit` via own Bash or agy `run_command`/`view_file`; require numeric
`0` and verify outputs before continuing. Read `.log` on failure. agy 1.2.14 has
no `command_status`/`send_command_input`; a launch return is not completion.
Use fresh step names/output directories for refinements. `video-qa` has no MCP
or delegation; return text to the parent for persistence and archival.

Extract/transcribe → transcript AND scene hotspots → 10 fps dense windows →
read every sheet through the visual helper → **re-densify** unclear moments at
up to 20 fps / tighter windows → re-fetch and re-read until resolved or **NOT
DETERMINED**. Cite sheet + tile + timestamp from `frames.tsv`. Scripts support
judgement; an optional convenience index never gates the loop.

**Verdict integrity (before emitting a QA verdict or "QA complete"):** Run `/qa-verdict-gate` over the run. It enforces tri-state **PASS / FAIL / INCONCLUSIVE** — `FAIL` is reserved for a *confirmed-observed* failure (a screenshot/click that reached the surface or an observed error in a tool result); a path you **couldn't reach** ("couldn't load", "element not found", blocked at step 0) is `INCONCLUSIVE`, never FAIL or PASS — and a QA run only counts when a `qa-report.md` with all the checklist items exists. `bun skills/golem-powers/qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs <transcript|->` (exit 3 = FLAG = the verdict isn't earned yet). Composes with `/false-green-gate` and `/never-fabricate`.

---

## Key Design Decisions (learned from real usage)

1. **The agent reads the SRT directly** — It chooses semantic hotspots from narration and combines them with `scene-cues.sh` visual-change cues. Automated audio-volume spikes do not replace transcript judgement.

2. **Dense action windows (mandatory)** — In QA mode, every action cue gets a dense-frame window, not a single frame. A click's target, hover state and resulting animation all happen in under a second; one frame every 30s plus ±5s hotspot frames cannot show what was clicked or how the UI reacted, and a 10-run eval found every "pixel-only" finding from that method was hallucinated or mis-scoped.
   - **Build `cues.tsv`** (`start_s<TAB>end_s<TAB>label`) from:
     - (a) every transcript segment whose text matches action language: click, clicking, press, tap, hover, drag, drop, scroll, open, close, select, toggle, switch, type, "when I", "now I", "this", "here", "look", "watch"
     - (b) `scripts/scene-cues.sh <video>` output — visual changes catch silent clicks and UI changes the narrator never mentions
     - (c) click logs, if `qa_click_logger` data exists for the session
   - **Run `scripts/dense-windows.sh <video> cues.tsv <outdir> [fps] [pre] [post]`** at 10 fps by default (5–20 allowed; use 20 fps for animations). It merges overlapping `[start-1.0s, end+2.0s]` windows, tiles frames into 5x4 contact sheets, and writes `index.tsv` (`sheet_file<TAB>window_start_s<TAB>fps<TAB>tiles<TAB>label`) plus `frames.tsv` (`sheet_file<TAB>tile<TAB>t_s`). Times are the extracted frames' real PTS, so `window_start_s` can be later than the padded cue start; tile *i* (row-major, 0-based) is at `window_start_s + i/fps`, and `frames.tsv` is exact.
   - **Have the visual helper read EVERY contact sheet, in order.** For each window, state: what the cursor targets, the before/after UI state, and any visual defect.
   - **Cite or label.** A visual finding must cite `sheet + tile index → timestamp` (e.g. `sheet_004.jpg tile 7 → 12.7s`). A finding with no sheet citation is transcript-only and must be labelled **transcript-only**.

3. **Interval frames are a coverage pass only** — Still extract one frame every 30 seconds so nothing between cues goes unseen, but never base a visual finding on an interval frame alone; if one shows something, add a cue there and re-run `dense-windows.sh`.

4. **Whisper model: `ggml-small`** — Fast on Apple Silicon (~14s for 7min video), accurate enough for English QA narration. The `ggml-large-v3` is better but 5x slower — not worth it for QA.

5. **Findings live in the PROJECT repo** — `docs/qa-session-YYYY-MM-DD-HHMM/` in the project being tested, not in the orchestrator. Each round gets a suffix: `qa-findings-round2.md`.

6. **BrainLayer storage is mandatory** — After every video processing run, `brain_store` the findings summary with tags `["qa", "<project>", "round-N"]`.

7. **QA is iterative** — Expect 3-6 rounds per feature. The skill supports multi-round workflows with proper round numbering and delta tracking (what was fixed vs. what persists).

8. **Gems use the same media primitives with a different analysis target** — QA hotspots look for bugs and UX issues. Gems hotspots look for surprising insights, strong opinions, technical revelations, numbers, examples, and reusable advice.

9. **BrainLayer is the destination for gems** — Files are intermediate artifacts. Use `brain_digest` for full transcripts/notes, then `brain_store` the structured gems. If BrainLayer is unavailable, write the full output to `docs.local/qa-video/[date]-[title].md` and flag that persistence failed.

10. **One pipeline route** — QA uses `qa-video-runner`, gems uses `video-gems`.
    Each owns extraction, hotspots and re-densification in its own Bash and calls
    `visual-gather.py` directly for images; lead/sub-agent contexts receive text
    only. A cmux `video-qa` worker is allowed only on Etan's explicit visible-worker
    request. This rule and the routing table are the same contract. Persistence
    and archival follow the evidence pass.

---

## Prerequisites

| Tool | Check | Install |
|------|-------|---------|
| ffmpeg + ffprobe | `which ffmpeg ffprobe` | `brew install ffmpeg` |
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
# Run each command in YOUR OWN shell. After EACH launch, poll its logs/*.exit
# and require 0 before continuing; read logs/*.log on failure.
bash "$SCRIPTS/run-step.sh" "$WORKDIR" extract -- bash "$SCRIPTS/extract.sh" "$VIDEO" "$WORKDIR"
# Wait for extract.exit=0. Read SRT; write chosen transcript hotspots to cues.tsv, then add scene cues.
bash "$SCRIPTS/run-step.sh" "$WORKDIR" scene -- bash "$SCRIPTS/scene-cues.sh" "$VIDEO"
# After logs/scene.exit exists and is 0, append the scene TSV output:
cat "$WORKDIR/logs/scene.log" >> "$WORKDIR/cues.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" dense -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/cues.tsv" "$WORKDIR/dense" 10
# Wait for dense.exit=0. Call visual-gather.py for every sheet (process.md Phase 4). If a moment is unclear, re-densify a single tighter window:
printf '1.0\t1.5\tunclear-target\n' > "$WORKDIR/refine-cues.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" refine-01 -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/refine-cues.tsv" "$WORKDIR/refine-01" 20 0 0
# Wait for refine-01.exit=0. Call the visual helper again; repeat as needed, or mark NOT DETERMINED. Full workflow includes
# 30-second coverage and sheet + tile + timestamp findings.
```

**For the full step-by-step, load [workflows/process.md](workflows/process.md).**

**Extract YouTube gems:**
```bash
# Give /qa-video the URL and load workflows/gems.md
/qa-video https://www.youtube.com/watch?v=VIDEO_ID
```
