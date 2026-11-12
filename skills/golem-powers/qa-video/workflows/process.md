# Video Processing: QA or Transcript-First Debrief

Before media work, route named model/subagent requests through [SKILL.md](../SKILL.md) § Subagent routing — named requests first.

**qa** keeps the dense action pipeline below. **debrief / review / gems** normally uses TRANSCRIPT-FIRST: ≤12 transcript questions/claims/numbers/referenced-slide moments, one still or ≤2 fps short window each, no blanket 30s coverage and no scene sweep unless narration references visuals. Default debrief budget is max(600, 24 × video minutes) seconds wall-clock; explicit --budget-seconds overrides it. Preserve/read debrief.md whenever transcript.srt exists, including BUDGET_EXCEEDED/PARTIAL; missing visual reads stay NOT DETERMINED. For these modes use `scripts/debrief.py VIDEO --workdir FRESH_DIR --mode debrief` through run-step.sh. By default debrief.py calls no helper: it extracts the targeted stills, writes frames.tsv and exits `STILLS_READY` so the judge hands the stills to its gatherers (it never reads them to plan); `--presort` runs the visual-batch.py gather inline. Then read the full SRT, debrief.md and the gatherer text, and spot-check ≤2 stills behind each visual claim you keep, for the final synthesis. Skip QA phases 3–5. Never infer visual coverage for unsampled parts of the video. The judge writes root progress.txt at every phase and gatherer text lands in visual/; on delay questions read progress.txt. For manual qa steps, rewrite root progress.txt on every phase transition too.

For full-pass/full-coverage/rigorous/exhaustive asks, visual-reference/catalog goals, or a silent
source (missing/empty transcript), follow [gems.md § Visual-first exhaustive](gems.md#visual-first-exhaustive)
instead of the capped debrief planner. That override also replaces Phase 4's
early context/PARTIAL exit: continue unread batches while time remains.

## Inputs Required
- `VIDEO` — path to the .mov screen recording
- `PROJECT_ROOT` — project repo receiving the QA session artifacts
- `WORKDIR` — optional existing session directory containing the recording and click log; QA defaults to `$PROJECT_ROOT/docs.local/qa-video/<run>/` so report and frame receipts share the gate's run root.
- For an explicitly requested visible `video-qa` worker, set an absolute `WORKDIR` under
  `$PROJECT_ROOT/docs.local/qa-video/` to obey its profile artifact scope.
- `ROUND` — round number for multi-round QA (default: 1)

See [stalker-pipeline.md](../references/stalker-pipeline.md) for the full media
command reference and troubleshooting notes.

## Execution Contract: Agent-Owned Iterative Loop

Default pipeline: one `claude.judgment` judge, a delegate child of the requesting seat, for QA/debrief/review
(on the machine holding the recording; SKILL.md § Execution routing gives the exact calls), and
`Agent(video-gems)` for gems. The judge is "the QA seat" and "you" below. It runs the packaged
extraction scripts in its **own shell** (a script, not a read), then gathers: gatherers read every
sheet and frame and return text with tile, frame path and `pts_s` — T3 `delegate_task` to
Antigravity (`gemini.gather.visual`), else `scripts/visual-batch.py` (driving visual-gather.py), else
TOOLING FAILURE; never the judge reading instead. The judge judges that text, connects it over time
(what changed across a cue, whether an element's state carries across windows) and spot-checks at most
2 full-size frames per reported finding. Gatherer text with frame refs is the evidence the judge
judges; Gemini never forms a verdict. `qa-video-runner` is only the contract for a judge with no
dispatch tool: it still gathers with visual-batch.py and returns NEEDS_READERS if that fails.
NEVER hand-roll a shell loop over sheets; shells must be Bash 3.2 safe.
Gatherers are leaf workers and never dispatch. The judge may use `Agent(visual-gatherer)` for
a few frames on a Claude terminal seat.

**Include this rule in every gatherer brief** (and apply it to your own spot-checks):

> Gatherers and spot-checks read frames and sheets one image per tool call, sequentially;
> never parallel or batched image reads in one turn. On `[media removed …]`
> (including `[media removed: request limit]`) or a request-limit result, treat
> that read as NOT inspected. Do not log it to the inspected ledger (`scripts/inspected.sh`);
> retry it serially. If the retry still fails, mark the item INCONCLUSIVE with a tooling note;
> never record a verdict from the failed read.

Only when Etan **explicitly** asks for a **visible worker**, the lead opens a
Gemini worker using `agy --agent video-qa` (golems#563). That worker owns the
same loop in its own shell and views the images itself (Etan's explicit request). **Never open a terminal pane**
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
every sheet read by its window's gatherer batch → you judge the text → **re-densify** or crop unclear
moments at up to the source fps / tighter windows → gather again until resolved or **NOT
DETERMINED**. Cite full-size frames or crops with `pts_s` from `frames.tsv`; the
sheet + tile only locates them. Follow SKILL.md § Evidence Rules; column and
helper details are in [provenance.md](../references/provenance.md). Scripts
support judgement; an optional convenience index never gates the loop.

## Phase 1: Audio Extraction + Transcription

```bash
VIDEO="/path/to/recording.mov"
: "${PROJECT_ROOT:?set PROJECT_ROOT to the project repo being tested}"
WORKDIR="${WORKDIR:-$PROJECT_ROOT/docs.local/qa-video/$(date +%Y-%m-%d-%H%M)}"
ROUND=1
SUFFIX=""
[ "$ROUND" -gt 1 ] && SUFFIX="-round${ROUND}"
# Keep each round's raw extraction separate; findings stay in WORKDIR.
# MEDIADIR is also this round's provenance run root (frames.tsv, inspected.tsv).
MEDIADIR="$WORKDIR/media${SUFFIX}"
SCRIPTS="<qa-video skill dir>/scripts"
# Own shell launch. Poll MEDIADIR/logs/extract.exit and require 0;
# then verify audio/SRT/TXT exist before Phase 2.
bash "$SCRIPTS/run-step.sh" "$MEDIADIR" extract -- bash "$SCRIPTS/extract.sh" "$VIDEO" "$MEDIADIR"
```

After `$MEDIADIR/logs/extract.exit` exists and is `0`, read `$MEDIADIR/transcript.srt`; confirm timestamps/content are usable.
`WHISPER_MODEL` overrides `~/.cache/whisper/ggml-small.bin`. If transcription
fails, stop this pass and report the failure; do not read a previous transcript.
Transcription defaults to English; set `WHISPER_LANGUAGE=auto` only when requested
(or set an explicit language code). The helper disables carried text context
(`--max-context 0`) to reduce repetition across segments and suppresses non-speech
tokens. Entropy/logprob/no-speech thresholds stay at 2.4/-1.0/0.6, with temperature
0 and fallback increments of 0.2 enabled. These supported whisper-cli settings
reduce loop risk; inspect the SRT for repetition before choosing hotspots.

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

QA uses dense windows around transcript AND scene hotspots; interval frames
provide QA coverage only. Debrief/review/gems uses the targeted path above.

### 3a. Regular Interval Frames (every 30 seconds)

Run coverage first: it creates the round's run ledger, and the later dense and
refine passes in child directories of `$MEDIADIR` append to it.

```bash
bash "$SCRIPTS/run-step.sh" "$WORKDIR" "coverage${SUFFIX}" -- bash "$SCRIPTS/coverage.sh" "$VIDEO" "$MEDIADIR"
# Poll logs/coverage${SUFFIX}.exit; require 0. Frames: $MEDIADIR/frames/interval-<t>s.png
# (t = 0, 30, 60… before duration), PTS decoded via showinfo, rows in $MEDIADIR/frames.tsv.
```

### 3c. Click Correlation (when `clicks.jsonl` exists)

Follow [click-capture.md](../references/click-capture.md) to convert click wall
clock timestamps into video-relative seconds, match each click to narration in
the seven-second forward window, and extract a frame at the click timestamp.
Treat the click log as sensitive: obtain explicit consent, use approved test
data, redact captured text and URLs before sharing, and delete the raw log after
the redacted findings and evidence frames are accepted. In QA mode, add each
click as a row in `cues.tsv` (3d) instead of relying on the single click frame.

### 3d. Dense Hotspot Windows (QA — mandatory)

Build `cues.tsv` (`start_s<TAB>end_s<TAB>label`) from transcript hotspots
(QA action-language), `scripts/scene-cues.sh` output and click logs (SKILL.md Key Design
Decision #2), then:

```bash
SCRIPTS="<qa-video skill dir>/scripts"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" "scene${SUFFIX}" -- bash "$SCRIPTS/scene-cues.sh" "$VIDEO"
# Poll logs/scene${SUFFIX}.exit; require 0, then append its TSV:
cat "$WORKDIR/logs/scene${SUFFIX}.log" >> "$WORKDIR/cues.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" "dense${SUFFIX}" -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/cues.tsv" "$MEDIADIR/dense" 10
# Poll logs/dense${SUFFIX}.exit; require 0 before Phase 4.
```

Outputs `sheet_NNN.jpg` (5x4 contact sheets), `index.tsv`
(`sheet_file<TAB>window_start_s<TAB>fps<TAB>tiles<TAB>label`), full-size frames
as `window_N-f_*.jpg` (`-q:v 3`; explicit `DENSE_FRAME_FORMAT=png` uses `window_N-f_*.png`) beside the sheets, and one headerless `frames.tsv` row per
extracted frame: `sheet_file`, `tile`, `t_s`, `frame`, `pts_s`, `source`, `sheet`, `sha256`, `repeat_of`, `crop_of`. The dir keeps a local ledger and mirrors each row
into `$MEDIADIR/frames.tsv`; count from the root only. crop.sh rows use
`source=crop` and fill `crop_of` with the parent frame. Take citation timestamps
from `pts_s`. Check `scripts/source-fps.sh "$VIDEO"` first: dense-windows.sh
accepts 1–120 fps, prints a WARN above the source fps and still runs, and the
extra frames are repeats (`repeat_of` set) that add no information.
Ledger-referenced files survive cleanup as durable inspection targets; only
unregistered intermediates are deleted. Check `df -g` / `df -k` before launching:
below 100 GB free, cap parallel dense-window jobs at 2. The per-outdir budget
is `DENSE_MAX_GB=5` by default; see provenance.md for retention controls.

## Phase 4: Gatherers Read the Sheets, You Judge the Text, Then Re-Densify

**Gatherers read every contact sheet; you never open one.** Split `index.tsv` into time-ordered
batches of ≤15 sheets (each with the adjacent window's last sheet) and gather, first route that works
(SKILL.md § Execution routing has the exact calls):

1. T3: one `delegate_task` per batch to `antigravity` / `gemini-3.8-flash` / `thinking_level: "high"`,
   all in one turn; save each returned text to `$MEDIADIR/visual/gather-b<N>.md`.
2. Otherwise, or when Antigravity is out: `bash "$SCRIPTS/default.sh" gather "$MEDIADIR"`, which runs
   the packaged batch driver (one sheet per call, default 3 concurrent, hard cap 4) in a fresh batch
   workdir inside `$MEDIADIR`, so coverage-count.sh finds its `visual/findings.jsonl`:

```bash
python3 "$SCRIPTS/visual-batch.py" --index "$MEDIADIR/dense/index.tsv" \
  --workdir "$MEDIADIR/visual-dense-01" --budget-seconds 480 --question \
  'Describe cursor targets and before/after states with zero-based tile indexes. Mark unclear moments NOT DETERMINED; never invent timestamps.'
```

3. Both failed: TOOLING FAILURE with the raw error path; unread windows stay NOT DETERMINED.
   Never fall back to reading the frames yourself or through a Claude helper.

For coverage frames, supply their absolute paths instead of `--index`.
NEVER hand-roll a shell loop over sheets. Shells must be Bash 3.2 safe.
Read `progress.txt`, `progress.json`, `visual/findings.jsonl` as calls finish and
`visual/summary.json` at the end. Exit 0 requires complete observations; inspect
the READ/INVALID/FAILED/NOT_READ counts and `covered=READ/total` (gathered coverage,
not your spot-checked count). Tile bounds
come from the index or `frames.tsv`; out-of-bounds and conflicting reads are
INVALID. Failed or invalid reads retry once with backoff within the budget.
Budget expiry stops new calls,
allows bounded in-flight calls to finish, and returns `BUDGET_EXCEEDED` with
unread sheets marked NOT DETERMINED. Quota/auth errors stop dispatch with a
nonzero exit and the cause: our own visual dispatch. Do not relaunch blindly.
Retry/refine only unresolved sheets within the remaining session budget, using
a fresh workdir. An unread/unresolved sheet never supports a visual finding.
**A gatherer, parser or validator failure is a TOOLING FAILURE.** Report
`TOOLING FAILURE` with the raw output path (`logs/<step>.log`, the saved raw
response); never report it as "no screenshots", and never read the frames instead.
`unresolved` lists unread sheets only; an ok finding with inline NOT DETERMINED tiles is a refinement candidate for those tiles.
An explicitly requested visible `video-qa` worker keeps the same evidence ledger.

**Judge the text.** Join the gatherer text with `frames.tsv` (tile → `frame`, `pts_s`) and the SRT,
in time order, and connect it: the before/after state around each cue, and whether an element's state
carries from one window to the next. For each window (sheet), state from the gathered text:

1. What the cursor targets and which tile shows the action
2. The before/after UI state across the tiles
3. Any visual defect (error, wrong state, layout, alignment, contrast)
4. What the user says (narration, described physical input) versus what the
   screen shows at this timestamp; narration alone never proves a UI state
5. What carried over from the previous window, or changed since it

**Work within the remaining wall-clock AND image-context budget.** Your context holds text plus
at most 2 spot-check frames per reported finding. Append each finding to the text ledger as you go,
so a stop loses no evidence; stop with honest partial coverage before the deadline.

**Spot-check, then cite or label.** For each finding you report, Read at most 2 full-size frames (the
cited before and after), one image per call, and log each with
`scripts/inspected.sh "$MEDIADIR" <frame> 'spot: before' <finding-id>` (it accepts only frames recorded in
that ledger). A disagreeing spot-check sends the window back to a gatherer; a second disagreement is NOT
DETERMINED. **Too small to read:** cut a crop with `scripts/crop.sh <frame> <x> <y> <w> <h> <out>`
(`<out>` must be `.png`) or re-densify, and gather the crop. **Measurements** (bar height/length/colour,
spinner motion, registration, timing) need a packaged script; with none, the item is NOT DETERMINED
(missing measurement: <what>) and you file a row to add it to `scripts/`. Never measure by eye or
hand-write a one-off measuring script. Every visual finding cites ≥1 full-size frame or crop before
the change and ≥1 after it, each read by a gatherer, with `pts_s` from
`frames.tsv` (e.g. before `<frame> @ 12.600s`, after `<frame> @ 12.800s`, found
via `sheet_004.jpg` tile 6–8). A tile alone is never the citation. A "no change"
claim stands only after a gatherer re-check that window at full size. A finding
without a frame citation is transcript-only and must be labelled
**transcript-only**. The lead receives text only.

**Coverage honesty.** The coverage line is the pasted output of
`scripts/coverage-count.sh "$MEDIADIR"` (`extracted= unique= repeated= inspected=
pre-sorted-only=`), counted from `frames.tsv` and `inspected.tsv`, never
estimated: `inspected` = your spot-checks, `pre-sorted-only` = gathered by visual-batch.py and not
spot-checked; delegate_task gathers add `gathered=N/M (batches b1..bK)`. Extracted is not gathered,
and a repeated frame is not a second observation. Never claim full
coverage nobody read. Keep the two verdicts apart: a failure a gatherer read and you spot-checked
stays a confirmed FAIL, whatever else went unread. The unread spans
are INCONCLUSIVE and can never earn a full-coverage PASS.

**Correlate** each frame with the corresponding SRT segment. The key advantage: you get BOTH what the user SAID and what they SAW, aligned by timestamp.

### Mandatory Re-Densification Loop

After the first gather, list moments where cursor target, before/after state or
motion remains unclear. For each, choose a tighter video-relative start/end and
raise sampling up to the source fps. Run in your own shell, with a fresh output directory
for each pass so earlier citations remain valid:

```bash
# Example only: choose these bounds from the actual unclear moment.
printf '12.1\t12.6\tunclear-click-target\n' > "$WORKDIR/refine-cues-01.tsv"
bash "$SCRIPTS/run-step.sh" "$WORKDIR" refine-01 -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/refine-cues-01.tsv" \
  "$MEDIADIR/refine-01" 20 0 0
```

Poll `logs/refine-01.exit` and require `0` before gathering the new sheets.
The final `0 0` disables cue padding, making this exactly one start/end/fps
window; a `refine*` directory records `source=refine`. A gatherer reads the new sheets (a delegate_task batch, or
`default.sh gather "$MEDIADIR" <new index.tsv> refine-01-gather`); use that pass's `frames.tsv` for exact tile timestamps. Repeat at different bounds if needed.
If source-rate sampling or source resolution cannot resolve the moment, mark it **NOT
DETERMINED**, explain the limitation and request better evidence. Higher output
fps cannot create detail absent from the original video. **When a gesture is
ambiguous**, ask the user for a slowed, narrated repro of it, and sample that
recording densely around the transition. An unresolved moment
never becomes a confirmed visual failure. Record every refinement pass and the
sheet/tile/timestamp that finally supports the finding.

## Phase 5: Compile QA Findings Document

Write to `$WORKDIR/qa-findings${SUFFIX}.md`. For the visible-worker route,
keep intermediates and this note in the assigned `docs.local` workdir; return
text paths to the parent, which copies the final note and cited evidence into
`$PROJECT_ROOT/docs/qa-session-.../`, preserving citation paths before Phase 6:

```markdown
# QA Session [Round N] — [Project] — YYYY-MM-DD

## Summary
- **Duration:** M:SS
- **Hotspots found:** N
- **Coverage:** `extracted=… unique=… repeated=… inspected=… pre-sorted-only=…` (pasted from coverage-count.sh)
- **Refinement passes:** [windows, fps, evidence, resolved / NOT DETERMINED]
- **Tooling failures:** `TOOLING FAILURE <step>: <raw output path>`, or none
- **Critical issues:** N
- **Major issues:** N
- **Minor/UX issues:** N
- **Enhancements:** N

---

## Finding 1: [Short descriptive title]
- **Timestamp:** M:SS–M:SS
- **Severity:** Critical / Major / Minor / UX / Enhancement
- **Narration / user says:** "[exact transcript quote]" plus any physical input the user describes (input is usually not visible)
- **Screen shows:** [what the frames themselves prove: page, state, visible elements, what changed]
- **Evidence:** before `<frame> @ 12.600s`, after `<frame> @ 12.800s` (full-size frames or crops a gatherer read and you spot-checked, `pts_s` from `frames.tsv`; list every frame relied on), or **transcript-only** if no frame shows it
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

### Final report and verdict (mandatory before Phase 6)

In the SAME turn that states the verdict, use Write/Edit with the absolute
`$WORKDIR/qa-report.md` path under `/…/qa-video/<run>/`, including all checklist items
and every FAIL id (`F1 FAIL` or `### F1: title — **FAIL**`). Frame paths stay under this run.
Then run `bash "$SCRIPTS/fail-evidence.sh" "$WORKDIR"` and expose its tool output:
unmodified TSV rows for every FAIL, not summaries. It reads only active files named
`inspected.tsv` under the run, including `$MEDIADIR/inspected.tsv` and `logs/inspected.tsv`;
`inspected-quarantine-*.tsv` is excluded. Keep `scripts/inspected.sh` as the only writer.
If it exits nonzero, re-inspect or downgrade the named item to INCONCLUSIVE, rewrite
the report and rerun in this turn; never fake a row. Run `/qa-verdict-gate` before the verdict.

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
