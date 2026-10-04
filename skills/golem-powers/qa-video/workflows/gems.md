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

Run each media step in your **own shell**; use background Bash
(`run_in_background`) for long ffmpeg/whisper jobs and wait for completion before
reading outputs. **Never open a terminal pane** or type into another surface to
run media tools; never use `send_to` for media commands. If your profile has no
shell, stop and ask the lead for the `video-qa` profile. Do not improvise a pane.
Claude seats use their own Bash. Gemini seats run `agy --agent video-qa` (profile
name pending confirmation from the golems profile lane; no cmuxlayer MCP).

The agent owns the whole iterative loop: extract/transcribe → choose transcript
AND scene hotspots → dense windows at 10 fps → read every contact sheet →
**re-densify** unclear moments at up to 20 fps and/or with tighter windows →
re-fetch and re-read until resolved or explicitly **NOT DETERMINED**. Scripts
are per-step helpers; they do not replace hotspot judgement. Each finding cites
its sheet + tile + timestamp from `frames.tsv`; unsupported claims remain
transcript-only. An optional convenience index never gates the loop.

## Steps

1. Create a session directory under `docs.local/qa-video/<slug>/` and set
   `WORKDIR` to it; set `SCRIPTS` to the qa-video skill's `scripts/` directory.
2. For YouTube, download metadata and **video** in your own shell; an audio-only
   download cannot provide visual evidence:
   ```bash
   yt-dlp --write-info-json --merge-output-format mp4 -o "docs.local/qa-video/<slug>/source.%(ext)s" "<url>"
   ```
   Use the actual downloaded video path. Local video needs no download.
3. In your own background Bash run
   `bash "$SCRIPTS/extract.sh" "$VIDEO" "$WORKDIR"`, then wait and verify SRT/TXT.
4. Read the transcript and choose gem hotspots: insights, opinions, revelations,
   numbers, examples and warnings. Write their start/end/labels to `cues.tsv`;
   append `scene-cues.sh` output so silent slide/code changes are covered.
5. Run `dense-windows.sh` on those cues at 10 fps. Also extract 30-second coverage
   frames as in `process.md`. Read EVERY initial sheet in index order, correlating
   its exact `frames.tsv` tile timestamps with the SRT.
6. **Re-densify** unclear slides, code, charts or transitions with tighter windows
   and up to 20 fps, then re-fetch and read every new sheet. Repeat until resolved
   or mark **NOT DETERMINED** with the source limitation. For a single exact window:
   ```bash
   printf '12.1\t12.6\tunclear-slide\n' > "$WORKDIR/refine-cues-01.tsv"
   bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/refine-cues-01.tsv" "$WORKDIR/refine-01" 20 0 0
   ```
   Use unique output directories per refinement. Cite sheet + tile + timestamp
   from that pass's `frames.tsv`; label unsupported visual claims transcript-only.
7. Produce a structured gems note with:
   - source title, URL, channel/speaker, and date if available
   - top gems with timestamps
   - direct action items
   - claims that need later verification
   - frame evidence references
8. Run `brain_digest` on the full transcript/note, then `brain_store` the
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
