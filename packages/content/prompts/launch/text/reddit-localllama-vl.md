# Reddit r/LocalLLaMA — VoiceLayer

> Post to: https://reddit.com/r/LocalLLaMA
> This audience cares about: local models, Apple Silicon optimization, no cloud dependencies
> Include: screen recording with audio + architecture diagram

## Title

Built a local voice I/O layer for AI coding agents — whisper.cpp with CoreML/Metal, edge-tts, zero cloud APIs

## Body

I built VoiceLayer to add bidirectional voice to AI coding agents without touching any cloud speech API.

**STT Architecture:**
- **Engine:** whisper.cpp compiled with CoreML + Metal support
- **Model:** ggml-base.en (~148MB) — good balance of speed vs accuracy for developer speech
- **Performance:** ~200-400ms transcription latency on M1 Pro for typical utterances
- **Recording:** sox with auto-detection (rec on macOS, arecord on Linux)
- **Stop mechanism:** User-controlled via `touch /tmp/voicelayer-stop` — silence detection (5s) is fallback only

**TTS:**
- edge-tts via Python bridge (Microsoft's neural voices, runs locally)
- Per-mode speech rate adjustment: announce is +10% faster, brief is -10% slower
- Audio playback via afplay (macOS) / aplay (Linux) with stop signal support

**No cloud. No API keys. No per-minute billing.**

For context: Vapi charges $0.05-0.25/min, Retell $0.07-0.33/min, ElevenLabs $0.30/min. VoiceLayer is free after the one-time model download.

**5 voice modes (7 MCP tools including aliases):**
1. `announce` — fire-and-forget TTS (status updates)
2. `brief` — one-way explanation at comfortable pace
3. `consult` — checkpoint before action (non-blocking)
4. `converse` — full bidirectional: agent speaks question → records mic → whisper transcribes → agent uses response
5. `think` — silent markdown notes (no audio, categorized as insight/question/red-flag)

**Session booking:**
- Lockfile-based mutex at `/tmp/voicelayer-session.lock`
- One voice session at a time — other MCP clients see "line busy"
- Prevents two agents from talking over each other

**Why whisper.cpp over alternatives:**
- whisper.cpp with CoreML: ~300ms for 5-10s audio on M1 Pro
- Compared: faster-whisper (great but Python-only), Whisper JAX (needs JAX setup), MLX Whisper (considered for future — need to benchmark quality vs speed)
- The CoreML path means near-zero GPU contention with other local models

**Stack:** TypeScript/Bun, MCP SDK, whisper.cpp, edge-tts, sox. MIT license. 75 tests, 178 assertions.

GitHub: https://github.com/EtanHey/voicelayer

Would love feedback from anyone running whisper.cpp locally — especially if you've compared base.en vs small.en for developer/technical speech, or if you've benchmarked MLX Whisper for this kind of short-form transcription.

---

## Notes for Etan

- r/LocalLLaMA wants the technical deep dive — model sizes, latency numbers, CoreML details
- Lead with whisper.cpp + CoreML — this audience respects Apple Silicon optimization
- The cost comparison (Vapi/Retell/ElevenLabs) will resonate — these are expensive services
- Ask for whisper model feedback — this community loves discussing model benchmarks
- If asked about larger models: small.en improves accuracy but doubles transcription time. base.en is the sweet spot for interactive use.
- If asked about Kokoro TTS: it's on the roadmap (MLX version exists), edge-tts is the pragmatic starting choice
- "Session booking" is a novel concept — nobody else does this for voice MCP servers
- Don't oversell — be honest about limitations: English-only whisper model by default, edge-tts voices are Microsoft's
