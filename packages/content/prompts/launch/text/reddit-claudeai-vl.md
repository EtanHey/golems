# Reddit r/ClaudeAI — VoiceLayer

> Post to: https://reddit.com/r/ClaudeAI
> Flair: "Built with Claude" or "Show & Tell"
> Include: 30-second screen recording with audio (NOT a GIF — voice is the point)
> Time: Day after BrainLayer post, or same day afternoon

## Title

I made Claude Code talk — and listen. 5 voice modes, local STT, zero cloud APIs.

## Body

I've been using Claude Code for 2 years. Typing every interaction is fine for coding. But for QA testing, code reviews, and brainstorming sessions — I wanted to just *talk*.

So I built **VoiceLayer**: an MCP server that gives Claude Code bidirectional voice.

[SCREEN RECORDING WITH AUDIO — 30s showing converse mode]

**5 voice modes:**
- `announce` — agent speaks status updates. "Build complete. 47 tests passing." Fire and forget.
- `brief` — agent reads back a summary or explanation at a comfortable pace. You listen.
- `consult` — checkpoint before action. "About to commit. Want to review?" Non-blocking.
- `converse` — full Q&A. Agent speaks a question, records your voice answer, transcribes it, uses it. This is the killer feature.
- `think` — silent notes. Agent writes insights to a markdown log. No audio.

**How it works:**
```json
{
  "mcpServers": {
    "voicelayer": { "command": "bunx", "args": ["voicelayer-mcp@2.2.4"] }
  }
}
```

That's it. Claude Code now has 7 voice tools (`qa_voice_announce`, `qa_voice_brief`, `qa_voice_consult`, `qa_voice_converse`, `qa_voice_think`, plus `qa_voice_say` and `qa_voice_ask` aliases) that it calls naturally mid-conversation.

**Stack:** edge-tts for speech synthesis, whisper.cpp with CoreML acceleration for transcription (~300ms on M1 Pro), sox for recording. Everything local.

**Session booking:** Only one voice session at a time (lockfile-based). Other Claude sessions see "line busy" and fall back to text. User-controlled stop — touch a file to kill recording instantly.

**Real usage:**
- QA testing: "How does the navigation look on mobile?" → speak your answer → agent incorporates feedback
- Code review debrief: agent reads back what changed, you discuss tradeoffs
- Discovery calls: interview clients with live note-taking via `think` mode

GitHub: https://github.com/EtanHey/voicelayer
Docs: https://etanhey.github.io/voicelayer/

Sister project: BrainLayer (persistent memory for coding agents). Together they form the "Layers" ecosystem — modular, local-first tools for AI agents.

---

## Notes for Etan

- This sub loves novel Claude Code integrations
- Video is ESSENTIAL — a voice product demonstrated via text is ironic. Record a real converse session.
- "5 voice modes" in the title creates curiosity — people want to know what the 5 are
- Expect questions about: latency (edge-tts ~1s, whisper ~300ms), Linux support (yes, via aplay), Windows (partial)
- If people ask "why not just use macOS dictation?": structured modes, MCP integration, agent-initiated conversation, session booking, think mode
- The `think` mode will stand out — nobody else has silent note-taking as a voice mode
- Don't be defensive about edge-tts being Microsoft — it's free, local, and the quality is excellent
