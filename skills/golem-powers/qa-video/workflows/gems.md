# Video Gems Workflow

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

Default pipeline: `Agent(qa-video-runner)` for QA, `Agent(video-gems)` for gems.
The pipeline sub-agent owns the whole iterative loop in its **own shell**;
never read images in the lead or pipeline sub-agent. Read text with Read;
call `scripts/visual-batch.py` from your own shell for every sheet/frame.
The driver invokes visual-gather.py concurrently and returns text only.
NEVER hand-roll a shell loop over sheets; helper shells must be Bash 3.2 safe.
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

**Mode: gems (or debrief/review)** — TRANSCRIPT-FIRST, default max(600, 24 × video minutes) seconds wall-clock budget; explicit --budget-seconds from the parent wins. Preserve transcript-derived debrief.md on budget/partial exits; absent visual reads stay NOT DETERMINED. Select ≤12 questions/claims/numbers/referenced-slide moments, one still or ≤2 fps short window each. No blanket 30s coverage and no scene sweep unless the transcript references visuals. Dense 10 fps/re-densify behavior belongs to qa. Write root progress.txt at every phase and findings incrementally. The parent runs the runner in the background and reads progress.txt on delay questions.

## Steps

1. Create a session directory under `docs.local/qa-video/<slug>/` and set
   `WORKDIR` to it; set `SCRIPTS` to the qa-video skill's `scripts/` directory.
2. For YouTube, download metadata and **video** in your own shell; an audio-only
   download cannot provide visual evidence:
   ```bash
   yt-dlp --write-info-json --merge-output-format mp4 -o "docs.local/qa-video/<slug>/source.%(ext)s" "<url>"
   ```
   Use the actual downloaded video path. Local video needs no download.
3. In your own shell launch `bash "$SCRIPTS/run-step.sh" "$WORKDIR" gems -- python3 "$SCRIPTS/debrief.py" "$VIDEO" --workdir "$WORKDIR" --mode gems`.
   Use a fresh workdir (source video/info.json and run-step logs are allowed); progress.txt covers every phase.
   Poll logs/gems.exit and inspect timing.json and actual outputs. A nonzero budget/partial exit still earns a transcript-only debrief.md when SRT exists; read it and report missing visual coverage.
4. Read the full transcript and plan.json; the English keyword planner ranks candidate moments across the duration, capped at 12. Synthesize insights/opinions/numbers and warnings from the full transcript, including transcript-only material.
5. Read targeted visual-batch.py findings.jsonl as they arrive; match each sheet + tile 0 + timestamp to frames.tsv (real PTS). NEVER hand-roll a shell loop. Keep absent/unclear observations NOT DETERMINED; no invented visuals.
6. If a referenced slide/code/chart needs another look, choose a tighter targeted still or ≤2 fps short window within the remaining computed total budget (or explicit parent deadline). Preserve each pass and citation. If unresolved or budget exhausted, report the limit.
7. Produce a structured gems note with:
   - source title, URL, channel/speaker, and date if available
   - top gems with timestamps
   - direct action items
   - claims that need later verification
   - frame evidence references
8. Return text to the parent to run `brain_digest` on the full transcript/note,
   then `brain_store` the
   structured gems with tags like `["video-gems", "<topic>", "<source>"]`.
9. If heavy raw media or transcripts should be kept, route them through
   `/drive-filing` (§ Archive a heavy artifact) and record the Drive location in the note.

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
