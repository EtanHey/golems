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

## Steps

1. The dispatcher creates a session directory under `docs.local/qa-video/<slug>/`.
2. For YouTube, the dispatcher downloads metadata and **video** in its own Bash
   (audio-only downloads cannot produce sheets):
   ```bash
   yt-dlp --write-info-json --merge-output-format mp4 -o "docs.local/qa-video/<slug>/source.%(ext)s" "<url>"
   ```
   Use the actual downloaded video path for `VIDEO`. For local media, use the
   supplied video directly. `yt-dlp` is required only for remote downloads.
3. The dispatcher runs `scripts/prepare.sh "$VIDEO" "$WORKDIR" --mode gems`
   in its own background Bash (`run_in_background: true`), waits for successful
   completion, and verifies `manifest.json` has `ready: true`. It extracts audio,
   SRT/TXT, deterministic gem/scene cues, dense sheets and 30-second coverage.
4. Only then delegate reading: in an Agent-tool context use
   `Agent(visual-gatherer)` (golems#553) over the manifest's sheets/transcript;
   in a cmux lane use a `gemini.gather.visual` gatherer pane. Its brief says:
   "Read manifest.json and the listed sheets/transcript only; never spawn panes,
   never send_to terminals, never run media tools."
5. The reader reads every listed sheet in order with transcript context and
   identifies insights, opinions, revelations, numbers, examples and warnings.
   Additional media requests go back to the dispatcher for cue/window rebuilds.
6. Capture slide text, code, charts, UI state and speaker claims with sheet/tile
   timestamps; distinguish transcript-only claims from visual evidence.
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
