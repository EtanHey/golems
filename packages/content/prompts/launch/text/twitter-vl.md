# Twitter/X — VoiceLayer Demo Thread

> Post from: @EtanHey
> Format: 5-7 tweet thread
> First tweet: MUST include screen recording with audio (voice is the product!)
> Time: Day 4-5 of launch sequence

## Thread

### Tweet 1 (Hook + VIDEO with audio)

I made my AI coding agent talk.

Not a chatbot. Not voice dictation. A real bidirectional voice interface for Claude Code.

5 voice modes. Local whisper.cpp. Zero cloud APIs. Zero per-minute billing.

[VIDEO: 20-30s screen recording of converse mode with audio]

### Tweet 2 (The 5 modes)

VoiceLayer has 5 modes, each designed for a different moment:

announce - "Build complete. 47 tests passing."
brief - agent reads back findings at your pace
consult - "About to commit. Want to review?"
converse - full voice Q&A (agent talks, you talk back)
think - silent notes to a markdown log

### Tweet 3 (The killer feature)

The `converse` mode is the one that changes everything.

Agent speaks: "How does the navigation look on mobile?"
You respond: "The hamburger menu is cut off on the right"
whisper.cpp transcribes in ~300ms
Agent adjusts the code.

No typing. Just talking.

### Tweet 4 (The stack)

Stack:
- TTS: edge-tts (neural voices, free, local)
- STT: whisper.cpp with CoreML acceleration
- Recording: sox
- Framework: MCP server (TypeScript/Bun)

One config line. Works with Claude Code, Cursor, VS Code.

### Tweet 5 (What it replaces)

Vapi: $0.05-0.25/min
Retell: $0.07-0.33/min
ElevenLabs: $0.30/min

VoiceLayer: Free. Forever. Everything local.

Built for developers who want voice without a credit card.

### Tweet 6 (Session booking — the novel bit)

One thing nobody else does: session booking.

Only one voice session at a time (lockfile mutex). Other Claude sessions see "line busy" and fall back to text.

Because two AI agents talking over each other is nobody's idea of productivity.

### Tweet 7 (CTA)

VoiceLayer is open source (MIT).

GitHub: github.com/EtanHey/voicelayer
Docs: etanhey.github.io/voicelayer

7 MCP tools. 5 voice modes. 75 tests.

Sister project: BrainLayer (persistent memory, 14 MCP tools)

Together: the Layers ecosystem. Modular, local, open source.

---

## Notes for Etan

- First tweet MUST have video with audio — a voice product needs to be heard, not read
- Keep each tweet under 280 chars
- The pricing comparison tweet is designed to be quote-tweeted by indie devs
- "Session booking" tweet is the novelty hook — nobody else has this concept
- Tag @alexalbert__ (Claude) if relevant, @charaborolet (whisper ecosystem)
- Consider posting the video as a standalone tweet first, then reply-threading for algo boost
- The "two AI agents talking over each other" line is memorable — people will screenshot it
