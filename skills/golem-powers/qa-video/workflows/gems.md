# Video Gems Workflow

Before media work, route named model/subagent requests through [SKILL.md](../SKILL.md) § Subagent routing — named requests first.

Use this workflow when the user shares a YouTube URL, asks to extract gems,
or wants durable insights/takeaways from a video instead of QA findings.

## Route

| Input | Handling |
|---|---|
| YouTube URL (`youtube.com`, `youtu.be`, `yt.be`) | Run the full gems workflow |
| Local video path plus "gems", "insights", or "takeaways" | Run gems analysis on the local media |
| Local recording plus "QA", "bugs", or "findings" | Use `process.md` instead |
| Ambiguous "process this video" | Ask whether the target is QA findings or reusable gems |

## Execution Contract

Default pipeline: `Agent(video-gems)` for gems, managed at
`../agents/video-gems.md` and installed by `skills/golem-powers/orc/scripts/install.sh`. Include
absolute skill/workflow paths, source, workdir and the remaining deadline.
The worker owns extraction and reader coordination in its own shell. Ordinary
transcript-first gems keeps one reader over the targeted stills. For exhaustive
mode, when it has dispatch tools it uses the SKILL.md image-reader fan-out. A nested Agent
without dispatch returns NEEDS_READERS plus ordered frame batches to its parent;
the parent dispatches readers and synthesizes their evidence. If neither can
dispatch, use the single-reader contract in `qa-video-runner.md`, disclose
`helpers 0 (dispatch unavailable)`, and still read every frame for exhaustive mode.
Each reader reads the images itself and returns text only. The parent stays text-only
when helpers are available. `visual-batch.py` (driving `visual-gather.py`) / `visual-gatherer` are optional
pre-sorting: a lead, never evidence; do not count pre-sort as reader fan-out.
`debrief.py` runs no helper unless you pass `--presort`.
NEVER hand-roll a shell loop over sheets; helper shells must be Bash 3.2 safe.

Only when Etan **explicitly** asks for a **visible worker**, the lead opens a
Gemini worker using `agy --agent video-qa` (golems#563). That worker owns the
same loop in its own shell and views the images itself, like the runner. **Never open a terminal pane**
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

**Default mode: gems (or debrief/review)** — TRANSCRIPT-FIRST unless the exhaustive override below applies, default max(600, 24 × video minutes) seconds wall-clock budget; explicit --budget-seconds from the parent wins. Preserve transcript-derived debrief.md on budget/partial exits; absent visual reads stay NOT DETERMINED. Select ≤12 questions/claims/numbers/referenced-slide moments, one still or ≤2 fps short window each. No blanket 30s coverage and no scene sweep unless the transcript references visuals. Dense 10 fps/re-densify behavior belongs to qa. Write root progress.txt at every phase and findings incrementally. The parent runs the runner in the background and reads progress.txt on delay questions.

## Visual-first exhaustive

Select **VISUAL-FIRST EXHAUSTIVE** for "full pass" / "full coverage"
(including "Full /qa-video GEMS pass"), "rigorous", "exhaustive", a
visual-reference/catalog goal, or a silent video (no audio, missing/empty
transcript). Do not run the ≤12-moment `debrief.py` planner for this mode; an
empty transcript is a mode switch, not a reason to end the visual pass.
"Full transcript debrief" alone requests the entire transcript, not exhaustive visuals.

1. Start one monotonic wall-clock deadline before setup; the same total budget
   includes extraction, readers, refinement and synthesis. Use the explicit
   parent deadline or max(600, 24 × video minutes) seconds. Display it.
2. Reuse existing frames and their decoded-PTS ledger. Otherwise run `coverage.sh`
   first, then `scene-cues.sh` and `dense-windows.sh` over visual changes; for a
   short silent clip sample the whole duration at 2 fps initially. Plan from
   metadata, not image loading. List every extracted frame in ordered batches.
3. Split across at least two image-reading helpers, **at most six full-size
   frames per helper task, including adjacent-boundary overlap**. Create more
   tasks, never larger batches; schedule waves within the parent's concurrency
   limit and use a fresh helper context per task. This conservative cap borrows
   `visual-gather.py`'s `FIRST_BATCH_SIZE=6` (2,000-character per-call output cap):
   six 1280×720 stills are 5.53M raw pixels; six 2822×2160 demo frames are 36.57M.
   Raw pixels are not a token estimate or a guarantee of fitting context; shrink
   further for large crops or a failed/overflowed read, down to singleton tasks.
   Keep absolute paths, the adjacent batch's boundary frame, mode and remaining
   deadline in each brief (SKILL.md § Execution routing owns role/model routing).
   Every helper opens **every full-size frame** assigned, logs each actual read
   with `inspected.sh` and its helper id, and returns one record per frame:
   `{frame_id, pts_s, finding, read_status, helper_id}`, plus unread IDs. `pts_s`
   comes from the decoded ledger, never a filename. The parent merges records
   by `(frame_id, pts_s)`, sorts by decoded timestamp, and collapses identical
   overlap records. Conflicting observations remain flagged for re-read, never
   silently overwritten. Compare merged reads with the complete extracted-frame
   manifest; list missing/unread IDs and unresolved conflicts as coverage gaps.
   A sheet, planned batch or pre-sort is not a full-size read. Dispatch-unavailable
   seats follow the single-reader fallback above without dropping frames.
4. Read all extracted frames, including new refinement frames. Densify scroll,
   hover, tooltip and transition windows at 10 fps up to source fps, using fresh
   `dense-windows.sh` output directories; use decoded PTS for before/after claims.
   Repeat unclear windows within the remaining budget. A source-resolution limit
   may stay NOT DETERMINED after inspection; an unread frame may not.
5. While unread frames or resolvable windows remain and time remains, continue:
   dispatch/rebatch unread IDs or read them in the no-dispatch fallback. Compact
   text findings and split smaller batches before context fills; context pressure
   alone does not authorize PARTIAL. Stop PARTIAL only on actual deadline expiry
   or a hard error (including failed reads/dispatch); identify the cause, raw error
   path, unread IDs and remaining time. Never idle just to consume the budget.
6. End with `frames read N/N, helpers K, budget used X/Y s, gaps [frame IDs/conflicts or none]`, computed from actual
   reader receipts and elapsed wall-clock, plus pasted `coverage-count.sh` output.
   Planned frames and requested helpers stay separate from actual reads/completed
   helpers. Do not label an unexecuted plan COMPLETE. Preserve transcript-derived
   notes when a transcript exists; a silent source earns visual-only notes.

## Steps

1. Declare default transcript-first or visual-first exhaustive using the rule above.
   For exhaustive mode follow that section, then steps 7–9; steps 3–6 are the
   ordinary transcript-first path only. Create a session directory under `docs.local/qa-video/<slug>/` and set
   `WORKDIR` to it; set `SCRIPTS` to the qa-video skill's `scripts/` directory.
2. For YouTube, download metadata and **video** in your own shell; an audio-only
   download cannot provide visual evidence:
   ```bash
   yt-dlp --write-info-json --merge-output-format mp4 -o "docs.local/qa-video/<slug>/source.%(ext)s" "<url>"
   ```
   Use the actual downloaded video path. Local video needs no download.
3. In your own shell launch `bash "$SCRIPTS/run-step.sh" "$WORKDIR" gems -- python3 "$SCRIPTS/debrief.py" "$VIDEO" --workdir "$WORKDIR" --mode gems`.
   By default debrief.py calls no helper: it extracts the targeted stills, writes frames.tsv and exits `STILLS_READY` for you to view them; `--presort` opts in to the visual-batch.py pre-sort.
   Use a fresh workdir (source video/info.json and run-step logs are allowed); progress.txt covers every phase.
   Poll logs/gems.exit and inspect timing.json and actual outputs. A nonzero budget/partial exit still earns a transcript-only debrief.md when SRT exists; read it and report missing visual coverage.
4. Read the full transcript and plan.json; the English keyword planner ranks candidate moments across the duration, capped at 12. Synthesize insights/opinions/numbers and warnings from the full transcript, including transcript-only material.
5. View the targeted `moment-NN.jpg` stills yourself (debrief.md marks each NOT YET VIEWED). With `--presort`, `visual/findings.jsonl` points you at them; it is not evidence. Match each sheet + tile 0 + timestamp to frames.tsv (real PTS). NEVER hand-roll a shell loop. Keep absent/unclear observations NOT DETERMINED; no invented visuals.
6. If a referenced slide/code/chart needs another look, choose a tighter targeted still or ≤2 fps short window within the remaining computed total budget (or explicit parent deadline). Preserve each pass and citation. If unresolved or budget exhausted, report the limit.
7. Produce a structured gems note with:
   - source title, URL, channel/speaker, and date if available
   - top gems with timestamps
   - direct action items
   - claims that need later verification
   - frame evidence references (full-size stills or crops with `pts_s` from frames.tsv)
8. Return text to the parent to run `brain_digest` on the full transcript/note,
   then `brain_store` the
   structured gems with tags like `["video-gems", "<topic>", "<source>"]`.
9. If heavy raw media or transcripts should be kept, route them through
   `/drive-filing` (§ Archive a heavy artifact) and record the Drive location in the note.

## Evidence Rules

SKILL.md § Evidence Rules applies here too; details in
[provenance.md](../references/provenance.md). For gems that means: cite the
full-size still or a `scripts/crop.sh` crop, never a tile alone; log each still
you view with `scripts/inspected.sh` and paste `scripts/coverage-count.sh` as
the coverage line; keep what the speaker says apart from what the screen shows
(a spoken claim about a slide is not proof of the slide). A helper or parser
failure is reported as `TOOLING FAILURE` with the raw output path, never as
"no screenshots".

## Failure Handling

BrainLayer persistence is mandatory. If `brain_digest` or `brain_store` fails:

```text
BRAINLAYER UNAVAILABLE — video gems were not persisted.
Raw output saved to docs.local/qa-video/<date>-<title>.md.
Retry brain_digest/brain_store after the MCP is healthy.
```

Do not silently skip persistence or claim the gems are durable until BrainLayer
or Drive storage has succeeded.

## Notes

- Exa or web search can be used only as a scout for whether a video is worth
  deep extraction. The full gems workflow uses the actual transcript and frames.
- For batches of 5+ videos, scout first, then run the full workflow on the top
  candidates.
- QA and gems share media tooling, but the analysis target differs: QA looks for
  bugs and UX issues; gems looks for durable knowledge.
