---
name: qa-video
description: "Video QA/extraction for screen, local video, YouTube. Triggers: narrated QA, bugs, QA checklist, video gems."
execute: scripts/default.sh
---

# /qa-video — Video-Based QA + Gems Pipeline

> Record your screen while narrating, or provide a YouTube/local video for knowledge extraction. The pipeline extracts speech, pulls visual context, and produces either structured QA findings or durable gems.

**Declare mode before dispatch.** **qa:** UI/app QA; mandatory 10 fps action-cue windows, scene cues, 30s coverage and refinement remain. **debrief / review / gems:** TRANSCRIPT-FIRST; transcribe, pick ≤12 moments (questions, claims, numbers, referenced slides), then one still or a ≤2 fps short window per moment. No blanket 30s coverage; no scene-cue sweep unless the transcript references visuals such as slides/code/screen share. Default budget: **max(600, 24 × video minutes) seconds total wall-clock**, including transcription and notes (25min → 600s; 90min → 2160s). An explicit parent remaining deadline wins. Preserve debrief.md whenever the transcript exists, even on budget/partial exits; unread visuals stay NOT DETERMINED.

## How It Works — QA mode

```
Local recording / YouTube video (downloaded in the agent's own shell)
  → extract.sh: ffmpeg audio + whisper-cli SRT/TXT
    → Agent selects transcript hotspots + scene-cues.sh visual changes
      → coverage.sh: 30s coverage + run ledger; dense-windows.sh: 10 fps contact sheets
        → The QA seat splits the windows across ≥2 helpers; each views its sheets itself,
          linking before/after across cues and windows; a verifier re-reads each finding
          (optional: visual-batch.py pre-sorts bulk sheets; its text is a lead, not evidence)
          → Unclear? Re-densify at up to the source fps / tighter windows and view again
            → Resolved or NOT DETERMINED, citing full-size frames/crops before and after
              → QA findings, BrainLayer persistence, requested handoff
```

**Progress contract:** the QA seat rewrites root `progress.txt` at every phase (extraction, fan-out, helpers done/total, verification, synthesis); each helper brief carries mode, absolute workdir, its windows and the remaining deadline, and helpers append `visual/findings.jsonl` as reads finish. When the user asks “what's taking so long”, read `progress.txt` and report its phase/count/ETA plus any blocker; never wait silently for the final note. A launch receipt is not completion: inspect the exit receipt and actual outputs.

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
| "I recorded QA", QA path to .mov file | [workflows/process.md](workflows/process.md) — Stalker pipeline processing |
| "send fixes to Codex", "hand off findings" | [workflows/handoff.md](workflows/handoff.md) — Agent handoff: T3 by default (findings doc, collab line, end task); cmux only on terminal seats |
| "next round", "retest", "QA round N" | [workflows/iterate.md](workflows/iterate.md) — Multi-round QA cycle |
| "set up click capture", "qa-record" | [references/click-capture.md](references/click-capture.md) — CGEventTap + qa-record.sh |
| "debrief", "review this video" | [workflows/process.md](workflows/process.md) — transcript-first debrief/review |
| YouTube URL, "video gems", "extract from video", "insights/takeaways from this video" | [workflows/gems.md](workflows/gems.md) — YouTube/local-video knowledge extraction with transcript + frames |

**Override signals:** If the user says "gems", "insights", or "takeaways", use the gems workflow regardless of source. If they say "QA", "bugs", or "findings", use the QA workflow regardless of source.

**If ambiguous:** Ask whether this is a QA recording to process or a video to extract gems from.

**Execution routing — ONE route per request:**

**Run where the recording lives.** The QA seat (the thread or agent that invoked
/qa-video) runs on the machine that holds the recording. If the recording is on
another Mac, the lead launches the QA thread on that Mac (`t3_thread_launch` with
its `environmentId`, per [agent-routing/references/cross-machine.md](../agent-routing/references/cross-machine.md)
§ 2: its brief tells the QA thread to report back with `t3_thread_send`, and the lead settles it;
admission (§ 5) applies). Never copy the recording to another machine.

**Subagent routing — named requests first:** When the user names a model or
subagent for the QA pass (a named model, or "use video-gems"), dispatch exactly
that model or subagent **before any media probe, extraction, transcription or
frame preparation**. The named worker owns
the entire pass. Never run its pipeline inline in the requesting seat, including
setup "for" the worker. This overrides the default owner and helper routes below.

In T3, call `orchestrator_capabilities` then `delegate_task` with the model the
user named and its provider, putting settings in `target.options`: Codex
`serviceTier:"default"`, Claude `fastMode:false`. Resolve named tiers through
`standards/model-roles.json` (`codex.subagent.mechanical` for the named Codex
mechanical tier; `claude.subagent.mechanical` for the named Claude mechanical
tier), using `node scripts/model-roles.mjs <role> --field model` (add
`--use codex-internal-subagent` for the explicitly requested Codex child), and
check the live catalog. A named agent profile belongs in the worker brief. Claude seats
outside T3 may use `Agent` with the named model/profile and `fastMode:false`.
Codex seats have no `Agent` tool: use `delegate_task`. If the requested model,
profile or dispatch tool is unavailable, say so and stop. Never substitute another
model, open a replacement pane, or fall back to inline execution. Give the worker
the source path, mode, absolute artifact directory, deadline and evidence rules;
a worker without dispatch tools follows the single-reader runner contract below.

**No model or subagent named:** Keep the default pipeline in this table.

| Request | Execution owner | Image reader |
|---|---|---|
| QA a recording (default) | The QA seat itself: extraction, transcript, hotspots and contact sheets in its own shell, then the fan-out below | ≥2 `claude.judgment` helpers, each Reading its frame windows' sheets/frames; a `claude.subagent.mechanical` verifier re-reads each candidate finding's frames |
| Debrief/review (default) | The QA seat itself (`debrief.py` in its own shell), mode=debrief/review | The same fan-out over the ≤12 moment stills (2 helpers is enough); verifier per kept visual claim |
| Extract gems (default) | `Agent(video-gems)` with source and artifact directory | `video-gems` itself (Read on stills); `visual-batch.py` pre-sort optional |
| Etan explicitly asks for a visible worker | Lead opens a cmux Gemini worker with `agy --agent video-qa` and an explicit absolute `docs.local` workdir | That worker views sheets and runs the same iterative loop |

**Default subagent routing:** Use this table once per unnamed request. Do not open an unrequested
Gemini pane, and do not hand the QA pipeline to a single runner sub-agent.
`video-gems` currently lives in `~/.claude/agents/video-gems.md`; its
packaging/helper update is a lead follow-up. If that local agent lacks the
helper contract, include this workflow in its brief.

Default pipeline (no named override): the QA seat for QA/debrief/review, `Agent(video-gems)` for gems.
The QA seat runs extraction, transcript, hotspots and contact sheets in its **own shell**.
After the transcript and hotspots it **fans out itself**: it splits the frame
windows in time order (along the transcript's sections) across **several
`claude.judgment` helpers**, roughly 10–15 sheets each and never fewer than 2
(a short clip gets 2). In T3: `delegate_task` to `claudeAgent` with that role's
model; on a Claude terminal seat: `Agent` with that role's alias (`node
scripts/model-roles.mjs claude.judgment --field model|alias`). Each helper
**reads the images itself**: it opens its sheets and the frames behind every
finding with Read and connects them over time: what changed between the
before/after frames of a cue, and whether an element's state carries across
its windows (give each helper the adjacent window's last sheet). It returns text
only. For each candidate finding the seat then dispatches a
`claude.subagent.mechanical` verifier that re-reads that finding's before/after
frames and returns CONFIRMED or NOT CONFIRMED. Helpers and verifiers log every
frame with `scripts/inspected.sh`, `why` prefixed by their id (`h2: before F4`,
`v-F4: verify`): their reads count as viewed, with that provenance. The seat
stays text-only and synthesizes: it never opens a sheet or frame itself, not to
plan the split (plan from `index.tsv`, cues and the transcript) and not to check
a helper (a doubtful or failed read goes to a verifier or a re-dispatch, or is
reported as TOOLING FAILURE). Gemini never forms a verdict.
`scripts/visual-batch.py` (driving visual-gather.py) is OPTIONAL bulk
pre-sorting, e.g. flagging candidate windows across hundreds of samples. Its
text is a lead, never evidence: view the frames before reporting a finding.
State how many samples were viewed (by which helper or verifier) versus pre-sorted only, and never
claim coverage nobody viewed. NEVER hand-roll a shell loop over sheets; helper shells must be Bash 3.2 safe.
One absolute deadline bounds setup probes, helper calls and retry backoff. Each
subprocess timeout is clamped to the remaining budget; expiry stops launches
and terminates in-flight helpers. Output overflow is an explicit failed read.
Helpers and verifiers are sub-agents and cannot dispatch: they never use the
Agent tool. That limit is theirs, not the QA seat's. The seat may use
`Agent(visual-gatherer)` for ad-hoc screenshot questions outside this pipeline.
`qa-video-runner` (`agents/qa-video-runner.md`, installed by `orc/scripts/install.sh`)
is off the default route: it is the single-reader contract for a QA seat with no
dispatch tool at all (a sub-agent, or headless `claude -p` without Agent), which
then runs the whole loop alone.

Only when Etan **explicitly** asks for a **visible worker**, the lead opens a
Gemini worker using `agy --agent video-qa` (golems#563). That worker owns the
same loop in its own shell and views the images itself, like the helpers. Its profile permits
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

**QA mode:** Extract/transcribe → transcript AND scene hotspots → 10 fps dense windows →
every sheet viewed by its window's helper (pre-sort optional) → **re-densify** unclear moments at
up to the source fps / tighter windows → re-fetch and view again until resolved or **NOT
DETERMINED**. Cite full-size frames or crops with `pts_s` from `frames.tsv`; the
sheet + tile only locates them. Scripts support judgement; an optional
convenience index never gates the loop.

**Verdict integrity (before emitting a QA verdict or "QA complete"):** Run `/qa-verdict-gate` over the run. It enforces tri-state **PASS / FAIL / INCONCLUSIVE** — `FAIL` is reserved for a *confirmed-observed* failure (a screenshot/click that reached the surface or an observed error in a tool result); a path you **couldn't reach** ("couldn't load", "element not found", blocked at step 0) is `INCONCLUSIVE`, never FAIL or PASS — and a QA run only counts when a `qa-report.md` with all the checklist items exists. `bun skills/golem-powers/qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs <transcript|->` (exit 3 = FLAG = the verdict isn't earned yet). Composes with `/false-green-gate` and `/never-fabricate`.

## Evidence Rules (every mode)

The helpers and verifiers are the readers; the tooling records provenance. Column and helper
details: [references/provenance.md](references/provenance.md).
If a provenance tool or column is missing, keep reading the frames directly, say
"provenance unavailable", and never synthesize counts or timestamps.

- **Sheets are an index.** Use contact sheets to find moments. A finding cites the
  full-size frame (`frames.tsv` `frame`) or a crop from
  `scripts/crop.sh <frame> <x> <y> <w> <h> <out>` (`<out>` must be `.png`), never a tile alone: small edge
  arrows, badges and focus rings get lost at tile size.
- **Before and after.** Every finding cites ≥1 frame before the change and ≥1
  after it. A "no change" claim stands only after the window is re-checked at
  full size.
- **Decoded timestamps.** Times come from `frames.tsv` `pts_s` (decoded pts), never
  from file names or `start + i/fps`. Keep extracted, inspected and repeated
  (`repeat_of` set) frames distinct. Sampling above the source rate
  (`scripts/source-fps.sh <video>`; dense-windows.sh warns) repeats frames and
  adds no information; a repeat is never a second observation.
- **Inspected ledger.** Log every frame you look at with
  `scripts/inspected.sh <workdir> <frame> <why> [finding-id]`. The report's
  coverage line is the pasted output of `scripts/coverage-count.sh <workdir>`.
- **Narration vs screen.** The report keeps **Narration / user says** (speech,
  described physical input such as trackpad gestures) apart from
  **Screen shows**. Input is usually invisible in a screen recording; narration alone
  never proves a UI state.
- **Tooling failure.** A helper, parser or validator failure is reported as
  `TOOLING FAILURE` with the raw output path, never as "no screenshots".
- **Slowed demo.** When a gesture is ambiguous, ask for a
  slowed, narrated repro and sample densely around the transition.

---

## Key Design Decisions (learned from real usage)

1. **The agent reads the SRT directly** — It chooses semantic hotspots from narration; QA combines them with `scene-cues.sh` visual-change cues. Automated audio-volume spikes do not replace transcript judgement.

2. **Dense action windows (mandatory)** — In QA mode, every action cue gets a dense-frame window, not a single frame. A click's target, hover state and resulting animation all happen in under a second; one frame every 30s plus ±5s hotspot frames cannot show what was clicked or how the UI reacted, and a 10-run eval found every "pixel-only" finding from that method was hallucinated or mis-scoped.
   - **Build `cues.tsv`** (`start_s<TAB>end_s<TAB>label`) from:
     - (a) every transcript segment whose text matches action language: click, clicking, press, tap, hover, drag, drop, scroll, open, close, select, toggle, switch, type, "when I", "now I", "this", "here", "look", "watch"
     - (b) `scripts/scene-cues.sh <video>` output — visual changes catch silent clicks and UI changes the narrator never mentions
     - (c) click logs, if `qa_click_logger` data exists for the session
   - **Run `scripts/dense-windows.sh <video> cues.tsv <outdir> [fps] [pre] [post]`** at 10 fps by default (1–120 accepted; it prints a WARN and repeats frames above `scripts/source-fps.sh`; use up to the source fps for animations). It merges overlapping `[start-1.0s, end+2.0s]` windows, tiles frames into 5x4 contact sheets, and writes `index.tsv` (`sheet_file<TAB>window_start_s<TAB>fps<TAB>tiles<TAB>label`) plus a headerless `frames.tsv` row per extracted frame (`sheet_file`, `tile`, `t_s`, `frame`, `pts_s`, `source`, `sheet`, `sha256`, `repeat_of`, `crop_of`; crop.sh rows use `source=crop` and fill `crop_of` with the parent frame; see [references/provenance.md](references/provenance.md)). Full-size frames stay beside the sheets as `window_N-f_*.png`. Times are the decoded pts, so `window_start_s` can be later than the padded cue start; take every timestamp from `frames.tsv`.
   - **Every contact sheet is viewed, in time order, by the helper that owns its window.** For each window, state: what the cursor targets, the before/after UI state, what carried over from the previous window or changed since it, and any visual defect. Work within the remaining wall-clock AND image-context budget: pick candidate windows before bulk image loading, keep the before/after and adjacent-window frames for each retained finding, append findings to the text ledger as you go, and stop with honest partial coverage before context runs out. If the budget forces a helper pre-sort, the sheets you did not view stay pre-sorted only, never confirmed.
   - **Cite or label.** A visual finding cites the full-size frames or crops a helper or verifier viewed, before and after, with `pts_s` (e.g. before `<frame> @ 12.600s`, after `<frame> @ 12.800s`, both `frame` paths from `frames.tsv`, located via `sheet_004.jpg` tile 6–8). A finding with no frame citation is transcript-only and must be labelled **transcript-only**.

3. **QA interval frames are a coverage pass only** — Still extract one frame every 30 seconds (`scripts/coverage.sh <video> <workdir>` → `frames/interval-<t>s.png`; run it first, since it creates the run ledger that dense and refine passes in child directories append to) so nothing between cues goes unseen, but never base a visual finding on an interval frame alone; if one shows something, add a cue there and re-run `dense-windows.sh`.

4. **Whisper model: `ggml-small`** — Fast on Apple Silicon (~14s for 7min video), accurate enough for English QA narration. The `ggml-large-v3` is better but 5x slower — not worth it for QA.

5. **Findings live in the PROJECT repo** — `docs/qa-session-YYYY-MM-DD-HHMM/` in the project being tested, not in the orchestrator. Each round gets a suffix: `qa-findings-round2.md`.

6. **BrainLayer storage is mandatory** — After every video processing run, `brain_store` the findings summary with tags `["qa", "<project>", "round-N"]`.

7. **QA is iterative** — Expect 3-6 rounds per feature. The skill supports multi-round workflows with proper round numbering and delta tracking (what was fixed vs. what persists).

8. **Gems use the same media primitives with a different analysis target** — QA hotspots look for bugs and UX issues. Gems hotspots look for surprising insights, strong opinions, technical revelations, numbers, examples, and reusable advice.

9. **BrainLayer is the destination for gems** — Files are intermediate artifacts. Use `brain_digest` for full transcripts/notes, then `brain_store` the structured gems. If BrainLayer is unavailable, write the full output to `docs.local/qa-video/[date]-[title].md` and flag that persistence failed.

10. **One pipeline route** — a named model/subagent owns the entire pass under
    Subagent routing; otherwise debrief and review follow the default QA route. QA: the QA seat,
    on the machine holding the recording, owns extraction, hotspots and refinement in its own Bash, then fans the
    frame windows out to ≥2 `claude.judgment` helpers that view the sheets/frames
    themselves, with a `claude.subagent.mechanical` verifier per candidate finding;
    no single runner. Gems uses `video-gems`. `visual-batch.py` is optional
    pre-sorting and the seat receives text only. A cmux `video-qa` worker is allowed only on Etan's explicit visible-worker
    request. This rule and the routing table are the same contract. Persistence
    and archival follow the evidence pass.

---

## Prerequisites

The QA seat runs where the recording lives (see Execution routing): a recording on another Mac gets its QA thread launched there with `environmentId`, never a copy.

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

**Process a QA video:**
```bash
VIDEO="/path/to/recording.mov"
WORKDIR="$HOME/Gits/<project>/docs/qa-session-$(date +%Y-%m-%d-%H%M)"
SCRIPTS="<qa-video skill dir>/scripts"
# Run each command in YOUR OWN shell. After EACH launch, poll its logs/*.exit
# and require 0 before continuing; read logs/*.log on failure.
bash "$SCRIPTS/run-step.sh" "$WORKDIR" extract -- bash "$SCRIPTS/extract.sh" "$VIDEO" "$WORKDIR"
# Wait for extract.exit=0. 30s coverage first: it creates the run ledger (frames.tsv).
bash "$SCRIPTS/run-step.sh" "$WORKDIR" coverage -- bash "$SCRIPTS/coverage.sh" "$VIDEO" "$WORKDIR"
# Wait for coverage.exit=0. Read SRT; write chosen transcript hotspots to cues.tsv, then add scene cues.
bash "$SCRIPTS/run-step.sh" "$WORKDIR" scene -- bash "$SCRIPTS/scene-cues.sh" "$VIDEO"
# After logs/scene.exit exists and is 0, append the scene TSV output:
cat "$WORKDIR/logs/scene.log" >> "$WORKDIR/cues.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" dense -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/cues.tsv" "$WORKDIR/dense" 10
# Wait for dense.exit=0. Fan the windows out: helpers view the sheets (process.md Phase 4; the seat never opens them; visual-batch.py pre-sort optional). If a helper reports a moment unclear, re-densify a single tighter window:
printf '1.0\t1.5\tunclear-target\n' > "$WORKDIR/refine-cues.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" refine-01 -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/refine-cues.tsv" "$WORKDIR/refine-01" 20 0 0
# Wait for refine-01.exit=0. Send the new sheets to a helper; repeat as needed, or mark NOT DETERMINED. Full workflow:
# inspected.sh per viewed frame, coverage-count.sh, full-size before/after findings.
```

**For the full step-by-step, load [workflows/process.md](workflows/process.md).**

**Extract YouTube gems:**
```bash
# Give /qa-video the URL and load workflows/gems.md
/qa-video https://www.youtube.com/watch?v=VIDEO_ID
```
