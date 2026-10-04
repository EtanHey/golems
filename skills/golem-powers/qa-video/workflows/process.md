# Stalker Pipeline: Video → Structured QA Findings

## Inputs Required
- `VIDEO` — path to the .mov screen recording
- `PROJECT_ROOT` — project repo receiving the QA session artifacts
- `WORKDIR` — optional existing session directory containing the recording and click log; defaults to a new timestamped directory under `$PROJECT_ROOT/docs/`
- `ROUND` — round number for multi-round QA (default: 1)

See [stalker-pipeline.md](../references/stalker-pipeline.md) for the full media
command reference and troubleshooting notes.

## Execution Contract: Agent-Owned Iterative Loop

Default pipeline: `Agent(qa-video-runner)` for QA, `Agent(video-gems)` for gems.
The pipeline sub-agent owns the whole iterative loop in its **own shell**;
never read images in the lead or pipeline sub-agent. Read text with Read;
call `scripts/visual-gather.py` directly from Bash for every sheet/frame.
A sub-agent cannot dispatch another sub-agent: never use the Agent tool from
inside the pipeline. The parent may use `Agent(visual-gatherer)` for ad-hoc
screenshot questions outside this pipeline.

Only when Etan **explicitly** asks for a **visible worker**, the lead opens a
Gemini worker using `agy --agent video-qa` (golems#563). That worker owns the
same loop in its own shell and may view images itself. **Never open a terminal pane**
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

## Phase 1: Audio Extraction + Transcription

```bash
VIDEO="/path/to/recording.mov"
: "${PROJECT_ROOT:?set PROJECT_ROOT to the project repo being tested}"
WORKDIR="${WORKDIR:-$PROJECT_ROOT/docs/qa-session-$(date +%Y-%m-%d-%H%M)}"
ROUND=1
SUFFIX=""
[ "$ROUND" -gt 1 ] && SUFFIX="-round${ROUND}"
# Keep each round's raw extraction separate; findings stay in WORKDIR.
MEDIADIR="$WORKDIR/media${SUFFIX}"
SCRIPTS="<qa-video skill dir>/scripts"
# Own shell launch. Poll MEDIADIR/logs/extract.exit and require 0;
# then verify audio/SRT/TXT exist before Phase 2.
bash "$SCRIPTS/run-step.sh" "$MEDIADIR" extract -- bash "$SCRIPTS/extract.sh" "$VIDEO" "$MEDIADIR"
mkdir -p "$WORKDIR/frames${SUFFIX}"
```

After `$MEDIADIR/logs/extract.exit` exists and is `0`, read `$MEDIADIR/transcript.srt`; confirm timestamps/content are usable.
`WHISPER_MODEL` overrides `~/.cache/whisper/ggml-small.bin`. If transcription
fails, stop this pass and report the failure; do not read a previous transcript.

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

Both QA and gems use dense windows around transcript AND scene hotspots;
interval frames provide coverage only.

### 3a. Regular Interval Frames (every 30 seconds)
```bash
DURATION=$(ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO" | cut -d. -f1)
FRAMEDIR="$WORKDIR/frames${SUFFIX}"

if [[ ! "$DURATION" =~ ^[0-9]+$ ]] || [ "$DURATION" -le 0 ]; then
  printf 'Could not determine a positive video duration: %s\n' "$DURATION" >&2
  exit 1
fi

# Choose t=0, 30, 60, ... strictly before duration. Launch one at a time.
t=0
[ "$t" -lt "$DURATION" ] || exit 1
bash "$SCRIPTS/run-step.sh" "$WORKDIR" "coverage${SUFFIX}-${t}" -- ffmpeg -y -nostdin -ss "$t" -i "$VIDEO" -vframes 1 -q:v 2 "$FRAMEDIR/interval-${t}s.jpg"
# Poll logs/coverage${SUFFIX}-${t}.exit; require 0 and a nonempty frame.
# Then repeat for the next coverage timestamp.
```

### 3c. Click Correlation (when `clicks.jsonl` exists)

Follow [click-capture.md](../references/click-capture.md) to convert click wall
clock timestamps into video-relative seconds, match each click to narration in
the seven-second forward window, and extract a frame at the click timestamp.
Treat the click log as sensitive: obtain explicit consent, use approved test
data, redact captured text and URLs before sharing, and delete the raw log after
the redacted findings and evidence frames are accepted. In QA mode, add each
click as a row in `cues.tsv` (3d) instead of relying on the single click frame.

### 3d. Dense Hotspot Windows (QA and gems — mandatory)

Build `cues.tsv` (`start_s<TAB>end_s<TAB>label`) from transcript hotspots
(action-language in QA; insights/claims/examples in gems), `scripts/scene-cues.sh` output and click logs (SKILL.md Key Design
Decision #2), then:

```bash
SCRIPTS="<qa-video skill dir>/scripts"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" "scene${SUFFIX}" -- bash "$SCRIPTS/scene-cues.sh" "$VIDEO"
# Poll logs/scene${SUFFIX}.exit; require 0, then append its TSV:
cat "$WORKDIR/logs/scene${SUFFIX}.log" >> "$WORKDIR/cues.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" "dense${SUFFIX}" -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/cues.tsv" "$WORKDIR/dense${SUFFIX}" 10
# Poll logs/dense${SUFFIX}.exit; require 0 before Phase 4.
```

Outputs `sheet_NNN.jpg` (5x4 contact sheets), `index.tsv`
(`sheet_file<TAB>window_start_s<TAB>fps<TAB>tiles<TAB>label`) and `frames.tsv`
(`sheet_file<TAB>tile<TAB>t_s`, the real PTS of every tile). Take citation
timestamps from `frames.tsv`.

## Phase 4: Read Every Sheet, Then Re-Densify Unclear Moments

**Read EVERY contact sheet in `index.tsv`, in order, through the helper.**
The lead and pipeline sub-agent never read images with Read or image tools.
They receive text observations only. Build absolute sheet paths from the index;
include every initial and refinement sheet. Call the helper serially in small
batches (up to six, fewer if its output cap omits findings):

```bash
python3 "$SCRIPTS/visual-gather.py" --question \
  'For each sheet, describe cursor targets and before/after states with zero-based row-major tile indexes. Mark unclear moments NOT DETERMINED; never invent timestamps.' \
  --timeout 90 "$WORKDIR/dense${SUFFIX}/sheet_001.jpg" \
  > "$WORKDIR/visual-dense-01.txt"
# Example path only: use actual index.tsv rows. Read the TEXT result.
```

Exit 0 alone does not prove coverage: require `Coverage: N/N; complete` and
one usable observation for every supplied path. On partial coverage, omitted
output or NOT DETERMINED, retry only those sheets in smaller serial batches;
then refine unclear moments below. Track reviewed paths against every index,
not merely the number of calls. Unread/unresolved evidence makes the pass
incomplete or NOT DETERMINED. Match returned tile indexes to `frames.tsv`;
Gemini must not infer timestamps. Coverage frames also go through the helper:
if one shows something, add a cue and extract dense evidence before citing it.
For an explicitly requested visible `video-qa` worker, view every sheet/frame
there and keep the same coverage and refinement ledger.

For each window (sheet), state:

1. What the cursor targets and which tile shows the action
2. The before/after UI state across the tiles
3. Any visual defect (error, wrong state, layout, alignment, contrast)
4. Whether the screen matches what the user was describing at this timestamp

**Cite or label.** Every visual finding cites `sheet + tile → timestamp` with the
timestamp from `frames.tsv` (e.g. `sheet_004.jpg tile 7 → 12.700s`). A finding
without a sheet citation is transcript-only and must be labelled
**transcript-only**.

**Correlate** each frame with the corresponding SRT segment. The key advantage: you get BOTH what the user SAID and what they SAW, aligned by timestamp.

### Mandatory Re-Densification Loop

After the first read, list moments where cursor target, before/after state or
motion remains unclear. For each, choose a tighter video-relative start/end and
raise sampling up to 20 fps. Run in your own shell, with a fresh output directory
for each pass so earlier citations remain valid:

```bash
# Example only: choose these bounds from the actual unclear moment.
printf '12.1\t12.6\tunclear-click-target\n' > "$WORKDIR/refine-cues-01.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" refine-01 -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/refine-cues-01.tsv" \
  "$WORKDIR/refine-01" 20 0 0
```

Poll `logs/refine-01.exit` and require `0` before calling the visual helper again.
The final `0 0` disables cue padding, making this exactly one start/end/fps
window. Re-fetch and call the visual helper for EVERY new sheet in its `index.tsv`; use that pass's
`frames.tsv` for exact tile timestamps. Repeat at different bounds if needed.
If 20 fps or source resolution cannot resolve the moment, mark it **NOT
DETERMINED**, explain the limitation and request better evidence. Higher output
fps cannot create detail absent from the original video. An unresolved moment
never becomes a confirmed visual failure. Record every refinement pass and the
sheet/tile/timestamp that finally supports the finding.

## Phase 5: Compile QA Findings Document

Write to `$WORKDIR/qa-findings${SUFFIX}.md`:

```markdown
# QA Session [Round N] — [Project] — YYYY-MM-DD

## Summary
- **Duration:** M:SS
- **Hotspots found:** N
- **Sheets read:** N / N across initial + refinement indexes (must be all)
- **Refinement passes:** [windows, fps, evidence, resolved / NOT DETERMINED]
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
- **Evidence:** dense/sheet_004.jpg tile 7 → 12.700s (sheet + tile + timestamp from `frames.tsv`; list every tile relied on), or **transcript-only** if no sheet shows it
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

## Phase 6: Parent Stores in BrainLayer

Return the text findings and evidence ledger to the parent, which runs:

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
