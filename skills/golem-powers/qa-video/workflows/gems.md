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

1. Create a scratch directory under `/tmp/qa-video-gems/<slug>/`.
2. Download metadata and audio:
   ```bash
   yt-dlp --write-info-json --extract-audio --audio-format wav -o "/tmp/qa-video-gems/<slug>/%(title)s.%(ext)s" "<url>"
   ```
3. Transcribe with `whisper-cli`, producing SRT and TXT.
4. Read the transcript and identify hotspot timestamps for:
   - surprising insights
   - strong opinions
   - technical revelations
   - hard numbers or benchmark claims
   - reusable examples, workflows, or warnings
5. Extract frames at each hotspot timestamp with `yt-dlp`/`ffmpeg`.
6. Read each frame with transcript context. Capture slide text, code, charts,
   UI state, speaker claims, and any visual evidence that changes the meaning.
7. Produce a structured gems note with:
   - source title, URL, channel/speaker, and date if available
   - top gems with timestamps
   - direct action items
   - claims that need later verification
   - frame evidence references
8. Run `brain_digest` on the full transcript/note, then `brain_store` the
   structured gems with tags like `["video-gems", "<topic>", "<source>"]`.
9. If heavy raw media or transcripts should be kept, route them through
   `/google-drive-archive` and record the Drive location in the note.

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
