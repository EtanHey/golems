# Show HN: VoiceLayer

> Post to: https://news.ycombinator.com/submit
> Best time: Tuesday-Thursday, 9-11am ET
> Link to: GitHub repo
> Be in comments for first 6 hours

## Title

Show HN: VoiceLayer -- Local voice I/O for AI coding agents (7 MCP tools, whisper.cpp, edge-tts)

## First Comment

Hi HN, I built VoiceLayer because typing every interaction with my AI coding agent felt wrong.

When you're doing QA, reviewing code, or having a design discussion -- you want to talk, not type. But existing voice AI platforms (Vapi, Retell) are built for business telephony with per-minute billing. I needed something local, free, and designed for developer workflows.

**VoiceLayer is an MCP server with 5 voice modes (7 tools including aliases):**
- `announce` -- fire-and-forget status updates ("Build complete. 47 tests passing.")
- `brief` -- agent reads back findings at slower pace (summaries, decisions)
- `consult` -- checkpoint before action ("About to push. Want to review the diff?")
- `converse` -- full bidirectional voice Q&A (agent speaks, records your answer, transcribes)
- `think` -- silent notes to a markdown log (no audio)

**Stack:**
- TTS: edge-tts (Microsoft's neural voices, runs locally via Python)
- STT: whisper.cpp with CoreML/Metal acceleration (~200-400ms on M1 Pro)
- Session booking: lockfile-based mutex (one voice session at a time, others see "line busy")
- User-controlled stop: `touch /tmp/voicelayer-stop` immediately kills recording

Everything runs locally. No cloud APIs, no per-minute billing, no data leaving your machine.

I use it daily for QA testing (voice-guided website walkthroughs), discovery calls (client interviews with live note-taking), and code review debriefs. The agent talks, I talk back, insights get captured.

GitHub: https://github.com/EtanHey/voicelayer
Docs: https://etanhey.github.io/voicelayer/

Built with TypeScript/Bun, MCP SDK, sox for recording. MIT license. 75 tests, 178 assertions.

This is a sister project to BrainLayer (persistent memory for coding agents) -- together they form a "Layers" ecosystem of modular AI agent tools.

---

## Notes for Etan

- VoiceLayer is more novel than BrainLayer -- "voice for coding" is unexpected
- HN will ask about latency, privacy, Whisper model size
- Be ready: whisper-cpp with ggml-base.en is ~148MB, transcription in 200-400ms
- "Why not just use macOS dictation?" -- because you need structured voice modes (announce vs converse vs think), session booking, and MCP integration
- If asked about Linux support: edge-tts and whisper.cpp work on Linux, audio player falls back to aplay
- The "think" mode is unique -- no competitor has silent note-taking as a voice mode
