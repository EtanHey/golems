# Stalker Pipeline: Video → Structured QA Findings

## Inputs Required
- `VIDEO` — path to the .mov screen recording
- `PROJECT_ROOT` — project repo receiving the QA session artifacts
- `WORKDIR` — optional existing session directory containing the recording and click log; defaults to a new timestamped directory under `$PROJECT_ROOT/docs/`
- `ROUND` — round number for multi-round QA (default: 1)

See [stalker-pipeline.md](../references/stalker-pipeline.md) for the full media
command reference and troubleshooting notes.

## Phase 1: Dispatcher Preparation

The dispatcher runs the single media entry point in its own Bash tool with
`run_in_background: true`. No media command is delegated to a visual reader.

```bash
VIDEO="/path/to/recording.mov"
: "${PROJECT_ROOT:?set PROJECT_ROOT to the project repo being tested}"
WORKDIR="${WORKDIR:-$PROJECT_ROOT/docs/qa-session-$(date +%Y-%m-%d-%H%M)}"
ROUND=1
SUFFIX=""
# Use a separate preparation directory for each round to retain prior evidence.
[ "$ROUND" -gt 1 ] && SUFFIX="-round${ROUND}"
PREPDIR="$WORKDIR/prepared${SUFFIX}"
SCRIPTS="<qa-video skill dir>/scripts"
bash "$SCRIPTS/prepare.sh" "$VIDEO" "$PREPDIR" --fps 10 --mode qa
```

Wait for successful background completion, then read `$PREPDIR/manifest.json`
and require `ready: true`. The manifest contains absolute ordered contact sheets,
coverage frames, SRT/TXT, cues, index, exact tile timestamps, duration and tool
versions. Missing dependencies or any failed media step block handoff; failed
reruns remove the previous ready manifest. `WHISPER_MODEL` overrides the default
`~/.cache/whisper/ggml-small.bin`. Static media gets an initial fallback window.

Preparation extracts action-language transcript cues and scene cues using the
existing scripts. If approved click logs exist, the dispatcher adds converted
video-relative cues (Phase 3c) and rebuilds dense windows before handing off.

## Reader Handoff

In an Agent-tool context use `Agent(visual-gatherer)` (golems#553) over the
manifest's sheets and transcript. In a cmux lane route the reading to a
`gemini.gather.visual` gatherer pane. Its brief must say:

> Read manifest.json and the listed sheets/transcript only; never spawn panes,
> never send_to terminals, never run media tools.

Read every sheet in manifest order. Claude handles semantic synthesis and
persistence after the reader returns its evidence. The dispatcher owns any
additional extraction or dense-window rebuild requested by the reader.

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

## Phase 3: Supplemental Dispatcher Cues

`prepare.sh` already produces dense windows and 30-second coverage frames.
Coverage frames flag places needing further dense inspection; they never back a
visual finding alone. If transcript analysis or coverage reveals a missed cue,
the dispatcher adds it to the manifest's cues file, runs `dense-windows.sh` and
removes readiness before rebuilding, validates the new artifacts, and atomically
republishes the manifest's ordered sheet list before a new reader handoff. The
reader reports requested timestamps and never executes extraction commands.

### 3c. Click Correlation (when `clicks.jsonl` exists)

Follow [click-capture.md](../references/click-capture.md) to convert click wall
clock timestamps into video-relative seconds, match each click to narration in
the seven-second forward window, and extract a frame at the click timestamp.
Treat the click log as sensitive: obtain explicit consent, use approved test
data, redact captured text and URLs before sharing, and delete the raw log after
the redacted findings and evidence frames are accepted. In QA mode, add each
click as a row in `cues.tsv` (3d) instead of relying on the single click frame.

### 3d. Dense Action Windows (QA mode — mandatory)

Preparation already builds `cues.tsv` (`start_s<TAB>end_s<TAB>label`) from
transcript and scene cues. For supplemental approved click or reader cues, the
dispatcher invalidates readiness, appends cues, then rebuilds:

```bash
SCRIPTS="<qa-video skill dir>/scripts"
"$SCRIPTS/dense-windows.sh" "$VIDEO" "$PREPDIR/cues.tsv" "$PREPDIR/dense" 10
```

Outputs `sheet_NNN.jpg` (5x4 contact sheets), `index.tsv`
(`sheet_file<TAB>window_start_s<TAB>fps<TAB>tiles<TAB>label`) and `frames.tsv`
(`sheet_file<TAB>tile<TAB>t_s`, the real PTS of every tile). Take citation
timestamps from `frames.tsv`.

## Phase 4: Visual Reader Analysis

**QA mode: read EVERY contact sheet listed in `index.tsv`, in order** (they're
images — use the Read tool). No sampling: skipping a
sheet means its window was never reviewed, and a finding from an unread sheet is
invalid. If there are too many sheets for one pass, split them across batches
(or the Gemini gatherer, Key Design Decision #10) — but every sheet is read.
Interval frames are a coverage pass only: if one shows something, add a cue and
re-run `dense-windows.sh`; never cite an interval frame as a finding's evidence.

Before Phase 5, confirm coverage: the number of sheets you read equals the row
count of `index.tsv`. If not, the QA pass is incomplete.

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

## Phase 5: Compile QA Findings Document

Write to `$WORKDIR/qa-findings${SUFFIX}.md`:

```markdown
# QA Session [Round N] — [Project] — YYYY-MM-DD

## Summary
- **Duration:** M:SS
- **Hotspots found:** N
- **Sheets read:** N / N in index.tsv (must be all)
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
