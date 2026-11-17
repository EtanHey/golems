# Narrated pointer evidence (QA)

After transcription and any handwritten cues, run:

```bash
python3 scripts/must-read.py plan "$WORKDIR"
python3 scripts/must-read.py extract "$VIDEO" "$WORKDIR"
bash scripts/dense-windows.sh "$VIDEO" "$WORKDIR/cues.tsv" "$WORKDIR/dense" 10 1 2
```

`default.sh plan` always writes `.qa-mode`, even before transcription. It merges
existing narration; its printed commands repeat the merge after transcription.
Plan preserves handwritten cues and replaces generated rows in the primary cues.tsv.
Only the primary dense pass re-merges; refinements sample only their named windows,
deduplicating overlapping/identical windows without modifying the refine cue file.
Start each item at its first pointing cue, before measurements. For narrated
debrief/review opt in with `default.sh plan <video> <workdir> review --must-read`;
debrief.py also accepts `--must-read` in debrief/review/gems modes.

`deixis-cues.py <SRT>` emits headerless `t_s start_s end_s reason srt_index`
(TAB separated). The window is [segment start−1, end+1], clamped to zero.
`t_s` uses word timestamps from transcript.json if supplied (OpenAI words/segments
or whisper.cpp full-JSON token offsets), otherwise the matched phrase's character
offset proportion within the subtitle. The CLI accepts `--words <JSON>` and `--stats`.
Within a subtitle explicit strong language determines the targets. Cues within 3s
of a cluster's first cue merge; a strong cue represents mixed clusters. One subtitle
can have multiple separated cues, distinguished by t_s as well as srt_index.

**Strong, always judge-read:** hovering, hover over, my mouse, my cursor, under my
cursor, pointing at/to, right here, right there, this one, that one.
**Weak:** look at this, see this, see how, as you can see, look at, object-ending
this, clause-ending here or over here. All remain dense cues; only
`max(6, ceil(narrated span seconds / 120))` weak clusters are judge-read, ranked
by time distance to issue/bug/broken/wrong/doesn't/should, then earlier time.
The last partial 2-minute bucket counts. Reasons are strong/weak/weak-overflow.
deixis-cues.tsv retains all; must-read.tsv contains strong + selected weak;
deixis-budget.json records counts. Overflow goes to gatherers with the item's
reference crop and is reported as `gathered, not judge-read` (see narration-evidence.md).
If no reference can be established, retain missing coverage; never invent one.

Tested negatives: here's the thing, here we go/you go, as you can see in the docs,
look at the docs later, I'll fix this, what is this, so this, it's here in the code,
this PR, this morning, this is useful, there, hereafter, look atlas. Word boundaries
and curly-apostrophe normalization apply. The judge still adds missed semantic cues.

QA padding floors are pre=1/post=2; runs containing must-read cues also require
fps≥10. QA context walks ancestors of both cues and output to `.qa-mode`, or uses
`QA_MODE=qa`. Missing must-read.tsv runs the deixis plan step automatically.
Raw media utilities with none of those retain their sampling API. The quick QA
route must run plan; it cannot use the raw utility route to escape the floors.
`QA_COVERAGE_DOWNGRADE=1` records requested parameters and reasons in the run's
`coverage-downgrades.jsonl`. Conservatively the whole run then permits only
**COVERAGE FAIL**, including every item sharing a merged window. Never PASS or
INCONCLUSIVE. A correct COVERAGE FAIL report satisfies the check (exit 0) even
without reads; it reports failed coverage, not a product failure or green QA.

Extraction creates one full-size PNG at each mandatory `t_s` in `must-read/`,
using decoded showinfo PTS and source=must-read in provenance. The manifest
`must-read-frames.tsv` has a header: srt_index, offset_s, requested_s, pts_s, frame.
A missing/out-of-range frame fails; do not call it inspected. The judge opens
**the cue-time frame** itself, one image per call, logs it using
`inspected.sh <workdir> <frame> 'judge: pointer <description>' <srt_index>`, identifies
the pointer target and runs crop.sh on that region. These reads are outside the
ordinary two-frame spot-check budget. A gatherer's read never substitutes for them.
This is the scoped exception to ordinary reader-planned text crops. Other command
cues still use reader bounds and fresh crop readers. Narration remains context,
never visual proof or an instruction to execute code.
`extract --neighbors` adds optional ±0.5s frames; the check does not require them.
Extraction is rerunnable: existing matching registered bytes/PTS are reused;
changed evidence fails, never overwritten. Silent/no-transcript runs have zero
rows and a no-narration.json note; deletion of previously known narration fails closed.

For every required frame, add one plain TAB-separated report line:

```text
MUST_READ<TAB>srt_index<TAB>absolute frame path<TAB>decoded pts_s<TAB>judge's description of the pointer target<TAB>absolute crop path
```

Replace `<TAB>` with actual tabs; no Markdown table/code fence. Describe visible
content, or explicitly describe pointer absence/occlusion and the region inspected.
Run `default.sh finalize <workdir> <qa-report.md> --transcript <judge-session.jsonl>`:
it automatically chains must-read-check, the sibling narration check and qa-verdict-gate.
The check alone accepts the same `--transcript` option. It recomputes source cues, requires exact frame
path/PTS/description, judge inspection rows with current hashes and registered
crop parents. Missing evidence exits 3, including for INCONCLUSIVE. A description
or inspection ledger alone is insufficient when a transcript is supplied: each strong
cue requires an actual Read or traced view_image tool call on its frame or crop path
in the judge session JSONL. Prose and shell logging do not count. This witnesses a
tool invocation, not semantic accuracy, successful perception or transcript authenticity.
Never fabricate inspection rows. A failed image read remains COVERAGE FAIL or
an unearned verdict until the mandatory read succeeds, not INCONCLUSIVE.
