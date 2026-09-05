# LinkedIn — VoiceLayer Launch Post

> Post from: Etan's personal profile
> Format: "Why I built this" founder story
> Include: Screen recording of actual voice session (30-60s, raw and authentic)
> Link: GitHub in FIRST COMMENT
> Time: 2-3 days after BrainLayer post

## Post

I talk to my AI coding agent now.

Not typing. Talking. Out loud. While coding.

It started because I was doing QA testing — walking through a website while my Claude Code agent took notes. Typing "the hamburger menu is cut off on mobile" while trying to resize a browser felt absurd.

So I built VoiceLayer — 5 voice modes for AI coding agents:

announce — "Build complete. 47 tests passing."
brief — Agent reads back a summary of what it found
consult — "About to push. Want to review the diff?"
converse — Full Q&A. Agent asks, you answer with your voice
think — Silent notes to a markdown log (no audio)

The stack is fully local:
- TTS: edge-tts (neural voices, no cloud)
- STT: whisper.cpp (~300ms on Apple Silicon)
- Session booking: one voice session at a time

No per-minute billing. No data leaving your machine.

I use it daily for QA testing, code review debriefs, and interview practice. The difference between typing and talking is bigger than I expected.

Open source, link in comments.

#VoiceAI #ClaudeCode #MCP #DeveloperTools

---

## First Comment

github.com/EtanHey/voicelayer

bunx voicelayer-mcp@2.2.4

5 voice modes, 7 MCP tools, 75 tests, MIT license. Docs at etanhey.github.io/voicelayer

Sister project to BrainLayer (persistent memory for AI agents).

---

## Notes for Etan

- Video > GIF > image for LinkedIn. A 30-second screen recording of you actually talking to Claude Code would be gold.
- Could record this with OBS or QuickTime — show the terminal, your voice, agent responding
- The "I talk to my AI agent" hook is unexpected and curiosity-driving
- VoiceLayer is more novel than BrainLayer — "voice for coding" surprises people
- Follow-up post idea: "5 voice modes I designed for AI agents (and why each exists)"
