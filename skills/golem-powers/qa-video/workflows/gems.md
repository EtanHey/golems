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

## Steps

1. Create a session directory under `docs.local/qa-video/<slug>/` and set
   `WORKDIR` to it; set `SCRIPTS` to the qa-video skill's `scripts/` directory.
2. For YouTube, download metadata and **video** in your own shell; an audio-only
   download cannot provide visual evidence:
   ```bash
   yt-dlp --write-info-json --merge-output-format mp4 -o "docs.local/qa-video/<slug>/source.%(ext)s" "<url>"
   ```
   Use the actual downloaded video path. Local video needs no download.
3. In your own shell launch
   `bash "$SCRIPTS/run-step.sh" "$WORKDIR" extract -- bash "$SCRIPTS/extract.sh" "$VIDEO" "$WORKDIR"`, then poll `logs/extract.exit`, require `0` and verify SRT/TXT.
4. Read the transcript and choose gem hotspots: insights, opinions, revelations,
   numbers, examples and warnings. Write their start/end/labels to `cues.tsv`;
   append `scene-cues.sh` output so silent slide/code changes are covered.
5. Launch `dense-windows.sh` through `run-step.sh` on those cues at 10 fps;
   poll its `.exit` and require `0`. Also extract 30-second coverage
   frames as in `process.md`. Call `visual-gather.py` from Bash for EVERY
   initial sheet in index order (process.md Phase 4), require complete path
   coverage and correlate its exact `frames.tsv` tile timestamps with the SRT.
6. **Re-densify** unclear slides, code, charts or transitions with tighter windows
   and up to 20 fps, then re-fetch and call the helper for every new sheet.
   Repeat until resolved
   or mark **NOT DETERMINED** with the source limitation. For a single exact window:
   ```bash
   printf '12.1\t12.6\tunclear-slide\n' > "$WORKDIR/refine-cues-01.tsv"
   bash "$SCRIPTS/run-step.sh" "$WORKDIR" refine-01 -- bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/refine-cues-01.tsv" "$WORKDIR/refine-01" 20 0 0
   ```
   Poll `logs/refine-01.exit` and require `0` before calling the visual helper again.
   Use unique output directories per refinement. Cite sheet + tile + timestamp
   from that pass's `frames.tsv`; label unsupported visual claims transcript-only.
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
