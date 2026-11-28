#!/usr/bin/env bash
set -euo pipefail

# AIDEV-NOTE: `plan` and `gather` are the gather-first execute route (Etan 2026-11-12: gatherers read
# the frames, one Opus judge child judges their text). No args keeps the prerequisite status check.
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = finalize ]; then
  [ $# == 5 ] && [ "$4" = --transcript ] || { echo 'usage: default.sh finalize <workdir> <qa-report.md> --transcript <judge-session.jsonl>' >&2; exit 2; }
  python3 "$SCRIPTS/reader-policy.py" "$2" "$5"
  bash "$SCRIPTS/must-read-check.sh" "$2" "$3" --transcript "$5"
  python3 "$SCRIPTS/narration-evidence.py" check "$2" "$3"
  exec bun "$SCRIPTS/../../qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs" "$5"
fi

if [ "${1:-}" = "plan" ]; then
  [ $# -ge 3 ] || { echo "usage: default.sh plan <video> <workdir> [qa|debrief|review]" >&2; exit 2; }
  VIDEO="$2"; WORKDIR="$3"; MODE="${4:-qa}"
  MUST_READ="${5:-}"
  [ -z "$MUST_READ" ] || [ "$MUST_READ" = --must-read ] || { echo 'plan: expected --must-read' >&2; exit 2; }
  case "$MODE" in qa|debrief|review) ;; *) echo "plan: mode must be qa, debrief or review (gems: Agent(video-gems))" >&2; exit 2;; esac
  JUDGE_MODEL="$(python3 "$SCRIPTS/model-role.py" claude.judgment)"
  READER_MODEL="$(python3 "$SCRIPTS/model-role.py" claude.subagent.cheap)"
  python3 "$SCRIPTS/reader-policy.py" plan "$WORKDIR"
  if [ "$MODE" = qa ] || [ "$MUST_READ" = --must-read ]; then
    mkdir -p "$WORKDIR"
    touch "$WORKDIR/.qa-mode"
    python3 "$SCRIPTS/must-read.py" plan "$WORKDIR"
    python3 "$SCRIPTS/narration-evidence.py" plan "$WORKDIR"
  fi
  if [ "$MODE" != qa ] && [ "$MUST_READ" = --must-read ]; then
    cat <<EOF
  After debrief transcription, opt-in pointer evidence:
  python3 "$SCRIPTS/must-read.py" plan "$WORKDIR"
  python3 "$SCRIPTS/must-read.py" extract "$VIDEO" "$WORKDIR"
EOF
  fi
  cat <<EOF
## /qa-video plan — mode=$MODE, gather-first
Requesting seat (lead, or whoever got the request): do no media work. Dispatch ONE Opus judge child and wait:
  T3: delegate_task({title: "qa-video judge", role: "test", target: {providerInstanceId: "claudeAgent", model: "$JUDGE_MODEL", options: {fastMode: false}}, task: "Read and follow $WORKDIR/briefs/qa-judge.md"})
  Claude terminal seat: Agent with that model and brief. Never t3_thread_launch/create_threads for QA.
  Wait for the judge with ONE bounded wait that always returns: t3_thread_wait({threadId: <childThreadId>, timeoutMs:
  <judge budget left>}); budget = max(600, 24 x video minutes) s + 300 s synthesis. On timeout report PARTIAL from the
  judge's progress.txt and findings so far; a late judge result becomes a dated addendum.
Judge (you, if you were dispatched) — run these scripts in your own shell, polling each logs/<step>.exit for 0:
EOF
  if [ "$MODE" = qa ]; then
    cat <<EOF
  bash "$SCRIPTS/run-step.sh" "$WORKDIR" extract -- bash "$SCRIPTS/extract.sh" "$VIDEO" "$WORKDIR"
  bash "$SCRIPTS/run-step.sh" "$WORKDIR" coverage -- bash "$SCRIPTS/coverage.sh" "$VIDEO" "$WORKDIR"
  bash "$SCRIPTS/run-step.sh" "$WORKDIR" scene -- bash "$SCRIPTS/scene-cues.sh" "$VIDEO"
  (read the SRT; write cues.tsv from transcript hotspots + logs/scene.log)
  python3 "$SCRIPTS/must-read.py" plan "$WORKDIR"
  python3 "$SCRIPTS/narration-evidence.py" plan "$WORKDIR"
  python3 "$SCRIPTS/must-read.py" extract "$VIDEO" "$WORKDIR"
  bash "$SCRIPTS/run-step.sh" "$WORKDIR" dense -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/cues.tsv" "$WORKDIR/dense" 10
Before any reader dispatch: run python3 "$SCRIPTS/reader-policy.py" admit "$WORKDIR" to admit the whole dense/index.tsv.
For targeted debrief/review stills: use admit "$WORKDIR" <all moment paths> instead.
Before any reader dispatch: estimate ALL sheets x price (default \$0.10/sheet including retry); above \$5 STOP and state cost unless a lead-authorized ceiling is recorded (SKILL.md cost section).
Authorization flags record an attestation the script cannot verify: pass --authorized-usd only when the brief quotes the lead's explicit dollar amount, with --authorized-by naming that lead; otherwise hold.
Re-plan clears authorization; record it with reader-policy.py admit AFTER default.sh plan (this wrapper does not forward authorization flags).
Gather (gatherers read every sheet; you never open one), first that works:
  1. Tool-free Claude reader: per batch of <=15 sheets from dense/index.tsv:
EOF
  else
    cat <<EOF
  Transcript-first: <=12 moments; cue window = containing transcript segment plus preceding three
  (all available at the start). Extract start + midpoint per cue window: <=24 stills.
  Count frame reads/waves within the same deadline; decoded PTS must lie inside the window, else refine or
  mark NOT DETERMINED. No 30 s coverage, no scene sweep.
  (Rigorous/full/exhaustive or a silent video: workflows/gems.md § Visual-first exhaustive, same gatherers.)
  bash "$SCRIPTS/run-step.sh" "$WORKDIR" $MODE -- python3 "$SCRIPTS/debrief.py" "$VIDEO" --workdir "$WORKDIR" --mode $MODE $MUST_READ
  (exit STILLS_READY: read transcript.srt, plan.json and debrief.md; the moment-NN-start.jpg / moment-NN-midpoint.jpg stills go to gatherers)
Before any reader dispatch: run python3 "$SCRIPTS/reader-policy.py" admit "$WORKDIR" to admit the whole dense/index.tsv.
For targeted debrief/review stills: use admit "$WORKDIR" <all moment paths> instead.
Before any reader dispatch: estimate ALL stills x price (default \$0.10/still including retry); above \$5 STOP and state cost unless a lead-authorized ceiling is recorded (SKILL.md cost section).
Authorization flags record an attestation the script cannot verify: pass --authorized-usd only when the brief quotes the lead's explicit dollar amount, with --authorized-by naming that lead; otherwise hold.
Re-plan clears authorization; record it with reader-policy.py admit AFTER default.sh plan (this wrapper does not forward authorization flags).
Gather (gatherers read every still; you never open one), first that works:
  1. Tool-free Claude reader: up to 24 stills means two batches (<=15 per batch):
EOF
  fi
  cat <<EOF
     delegate_task({title: "qa-video gather bN", role: "research", target: {providerInstanceId: "claudeAgent", model: "$READER_MODEL"}, task: "Read and follow $WORKDIR/briefs/gather-bN.md; run $SCRIPTS/claude-image-helper.py with --model $READER_MODEL --admission $WORKDIR/visual/cost-admission.json, one image per call within the remaining deadline; return text only"})
  2. bash "$SCRIPTS/default.sh" gather "$WORKDIR"$([ "$MODE" = qa ] || printf ' "" %s-gather "%s"/moment-*.jpg' "$MODE" "$WORKDIR")   (visual-batch.py, tool-free Claude reader)
  (For debrief/review, moment-*.jpg includes both start and midpoint files.)
  3. STOP: no frames were read; no QA verdict. TOOLING FAILURE with the raw error path; unread windows stay NOT DETERMINED. Never read the frames instead.
Wait budgets, enforced by bounded waits (never by a completion wake): 300 s per gatherer call, the gather stage gets
  max(600, 24 x video minutes) s, each timeout = the earliest of call/stage/parent deadline.
  T3: delegate_task mode:"wait", timeoutMs:300000; on timeout task_cancel that child. Parallel: dispatch async, then one
  t3_thread_wait({threadId: <childThreadId>, timeoutMs: <remaining>}) per child; task_cancel any child still running at
  the stage deadline. Scripts: visual-batch.py clamps every call to its absolute deadline.
  Zero valid reads: STOP with "no frames were read" and no QA verdict.
  With visual evidence, a stalled stage yields PARTIAL at the deadline: name the missing windows NOT DETERMINED, continue with what
  arrived, mark the report PARTIAL.
Judge the gatherer text; spot-check <=2 full-size frames per reported finding (inspected.sh 'spot: ...' <id>).
QA exception: open EVERY must-read frame yourself, one per call; log with inspected.sh 'judge: pointer ...',
crop the identified pointer region via crop.sh and write MUST_READ report rows (references/must-read.md).
Finalize QA automatically: bash "$SCRIPTS/default.sh" finalize "$WORKDIR" "$WORKDIR/qa-report.md" --transcript <judge-session.jsonl>
This chains must-read-check (actual strong-cue image reads), narration-evidence and /qa-verdict-gate.
Pin the first pointer crop per item via 'reference'; use 'sweep' briefs for every later gather.
Every named value and negative gatherer claim needs a judge frame; indicator-chosen frames need >=1s render lag.
Briefs pass verbatim narration or transcript path and say 'look where the pointer is'.
Explicit gatherer model/exclusion in the requesting brief wins over the defaults above; never use an excluded fallback.
Gemini only when explicitly named: visual-batch.py --helper "$SCRIPTS/visual-gather.py" --model <named concrete ID>.
Too small: crop.sh or re-densify, then gather again. Missing measurement script: NOT DETERMINED + file a row.
EOF
  exit 0
fi

if [ "${1:-}" = "gather" ]; then
  [ $# -ge 2 ] || { echo "usage: default.sh gather <workdir> [index.tsv|\"\"] [step] [image ...]" >&2; exit 2; }
  WORKDIR="$2"; INDEX="${3:-}"; STEP="${4:-gather-01}"
  [ $# -ge 4 ] && shift 4 || shift $#
  # Historical Gemini timings informed these deadlines; Claude latency remains unmeasured.
  # The stage stops at its budget, regardless of provider.
  BUDGET="--budget-seconds ${GATHER_BUDGET_S:-600} --timeout ${GATHER_CALL_S:-300}"
  QUESTION='Per tile: cursor target, before/after UI state, visible defects, with zero-based tile indexes. Mark unclear tiles NOT DETERMINED; never invent timestamps.'
  export QA_VIDEO_ADMISSION="$WORKDIR/visual/cost-admission.json"
  if [ $# -gt 0 ]; then
    if [ -f "$WORKDIR/dense/index.tsv" ]; then
      python3 "$SCRIPTS/reader-policy.py" admit "$WORKDIR" --index "$WORKDIR/dense/index.tsv"
    fi
    # Include crops/refinements alongside the complete index; admit accumulates.
    python3 "$SCRIPTS/reader-policy.py" admit "$WORKDIR" "$@"
    # shellcheck disable=SC2086
    exec bash "$SCRIPTS/run-step.sh" "$WORKDIR" "$STEP" -- python3 "$SCRIPTS/visual-batch.py" \
      --workdir "$WORKDIR/visual-$STEP" $BUDGET --question "$QUESTION" "$@"
  fi
  INDEX="${INDEX:-$WORKDIR/dense/index.tsv}"
  [ -f "$INDEX" ] || { echo "TOOLING FAILURE: no index at $INDEX (run dense-windows.sh first)" >&2; exit 3; }
  python3 "$SCRIPTS/reader-policy.py" admit "$WORKDIR" --index "$INDEX"
  # shellcheck disable=SC2086
  exec bash "$SCRIPTS/run-step.sh" "$WORKDIR" "$STEP" -- python3 "$SCRIPTS/visual-batch.py" \
    --index "$INDEX" --workdir "$WORKDIR/visual-$STEP" $BUDGET --question "$QUESTION"
fi

ORCHESTRATOR_REPO="${ORCHESTRATOR_REPO:-$HOME/Gits/orchestrator}"

echo "## /qa-video — Video-Based QA Pipeline"
echo ""
echo "### Prerequisites Check"

# Check ffmpeg
if command -v ffmpeg &>/dev/null; then
  echo "- [x] ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"
else
  echo "- [ ] ffmpeg: NOT FOUND (brew install ffmpeg)"
fi

# Check whisper-cli
if command -v whisper-cli &>/dev/null; then
  echo "- [x] whisper-cli: installed"
else
  echo "- [ ] whisper-cli: NOT FOUND (brew install whisper-cpp)"
fi

# Check whisper model
MODEL="$HOME/.cache/whisper/ggml-small.bin"
if [ -f "$MODEL" ]; then
  SIZE=$(du -h "$MODEL" | cut -f1)
  echo "- [x] ggml-small model: $SIZE"
else
  echo "- [ ] ggml-small model: NOT FOUND (whisper-cli --download-model small)"
fi

# Check click logger
LOGGER="$ORCHESTRATOR_REPO/scripts/qa/qa_click_logger.py"
if [ -f "$LOGGER" ]; then
  echo "- [x] qa_click_logger.py: exists"
else
  echo "- [ ] qa_click_logger.py: NOT FOUND"
fi

# Check qa-record.sh
RECORDER="$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh"
if [ -f "$RECORDER" ]; then
  echo "- [x] qa-record.sh: exists"
else
  echo "- [ ] qa-record.sh: NOT FOUND"
fi

# Check pyobjc (optional)
if python3 -c "import Quartz" 2>/dev/null; then
  echo "- [x] pyobjc (click capture): installed"
else
  echo "- [ ] pyobjc (click capture): NOT INSTALLED (optional — pip3 install pyobjc-framework-Quartz pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa)"
fi

echo ""
echo "### Available Workflows"
echo ""
echo "| Command | What it does |"
echo "|---------|-------------|"
echo "| \`/qa-video\` | This status check; \`default.sh plan <video> <workdir>\` prints the gather-first route |"
echo "| Load \`workflows/record.md\` | Pre-QA checklist + recording setup |"
echo "| Load \`workflows/process.md\` | Process video → structured findings |"
echo "| Load \`workflows/handoff.md\` | Send findings to implementing agent |"
echo "| Load \`workflows/iterate.md\` | Multi-round QA cycle |"
echo ""
echo "### Quick Start"
echo ""
echo "1. **Record:** \`bash \"$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh\" ~/Gits/<project>/docs/\`"
echo "2. **Process:** \`bash $SCRIPTS/default.sh plan <video> <workdir>\` — one Opus judge child, gatherers read the frames"
echo "3. **Handoff:** I'll format findings and send to your implementing agent"
