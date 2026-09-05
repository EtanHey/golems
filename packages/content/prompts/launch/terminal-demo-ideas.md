# Terminal Product Demo Ideas

> These showcase REAL functionality. Not mockups. Record actual sessions.
> Tools: VHS (.tape files), OBS Studio (video with audio), QuickTime (quick captures)

## Demo 1: BrainLayer Search in Action (VHS, 15s GIF)

**What to show:** Real `brainlayer search` query returning past decisions
**Script:**
1. Type: `brainlayer search "how did I implement authentication"`
2. Show real results with session date, project, decision text, importance score
3. Type: `brainlayer search "database migration strategy"`
4. Show different results — demonstrating breadth

**Why it works:** Developers instantly understand the value when they see a real search returning real past decisions.

## Demo 2: MCP Integration Live (Screen recording, 30s)

**What to show:** Claude Code session where the agent uses brainlayer_search mid-conversation
**Script:**
1. Start a Claude Code session
2. Ask: "What approach did we use for auth in this project?"
3. Watch Claude call `brainlayer_search` and incorporate the result
4. Show the tool call in the terminal output

**Why it works:** Shows the MCP integration isn't theoretical — it's a real tool the agent uses automatically.

## Demo 3: VoiceLayer Announce Mode (Screen recording WITH AUDIO, 20s)

**What to show:** Claude Code using qa_voice_announce to speak a status update
**Script:**
1. Claude Code running a build
2. Agent calls: `qa_voice_announce("Build complete. 47 tests passing.")`
3. You hear the voice speak the message through your speakers
4. Terminal shows `[announce] Spoke: "Build complete. 47 tests passing."`

**Why it works:** Hearing the voice is the "wow" moment. A GIF can't capture this — use video with audio.

## Demo 4: VoiceLayer Converse Mode (Screen recording WITH AUDIO, 45s)

**What to show:** Full voice Q&A cycle
**Script:**
1. Agent calls: `qa_voice_converse("How does the navigation look on mobile?")`
2. You hear the question spoken aloud
3. You respond (your voice recorded): "The hamburger menu is cut off on the right side"
4. Terminal shows transcription of your response
5. Agent incorporates the feedback

**Why it works:** This is the killer demo. Bidirectional voice with an AI agent in a terminal. Nobody has seen this before.

## Demo 5: Full Golems Ecosystem (Longer video, 2-3 min)

**What to show:** BrainLayer + VoiceLayer + Telegram notifications working together
**Script:**
1. Start Claude Code session
2. Agent searches memory: "What was I working on yesterday?" → brainlayer_current_context
3. Agent announces: "Found 3 sessions from yesterday. The main one was refactoring auth."
4. You say: "Let's continue that work"
5. Agent recalls file timeline for auth.ts
6. After making changes: agent consults "About to commit. Want to review?"
7. Telegram notification arrives on phone

**Why it works:** Shows the "multiplayer" experience — memory + voice + notifications as a cohesive system.

## Demo 6: BrainLayer CLI Tour (VHS, 30s GIF)

**What to show:** The CLI's Rich-powered interface
**Script:**
1. `brainlayer stats` → show knowledge base stats with Rich formatting
2. `brainlayer search "react hooks" --limit 3` → formatted search results
3. `brainlayer enrich-sessions --stats` → enrichment progress bar
4. `brainlayer-mcp` → show MCP server starting up

**Why it works:** CLI polish signals quality. A beautiful terminal UI makes people want to try it.

## Recording Tips

### VHS (GIFs for README/social)
```bash
brew install vhs
vhs record                    # Interactive recording
vhs brainlayer-demo.tape      # Script-based recording
```

### OBS Studio (Videos with audio)
- Scene: Terminal window + mic input
- Output: 1080p MP4, 30fps
- Crop to just the terminal (no desktop clutter)
- Use dark terminal theme (Catppuccin Mocha matches both READMEs)

### QuickTime (Quick captures)
- File > New Screen Recording
- Select terminal window only
- Enable mic for voice demos

### Post-processing
- GIFs: optimize with `gifsicle --optimize=3 --colors 256`
- Videos: trim with `ffmpeg -i input.mp4 -ss 0 -t 30 output.mp4`
- Thumbnails: take a still at the most impressive moment

## Where to Use Each Format

| Format | Best For |
|--------|----------|
| GIF (VHS) | README, GitHub, Reddit inline, LinkedIn inline |
| MP4 (OBS) | LinkedIn video post, Twitter video, YouTube |
| Asciinema | Docs site (interactive, copy-pasteable) |
| Remotion | Product hero videos, LinkedIn carousel-style |
| Screenshot | Quick social posts, architecture diagrams |
