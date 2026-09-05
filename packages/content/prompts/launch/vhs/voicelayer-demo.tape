# VoiceLayer Demo — Terminal GIF
# Install VHS: brew install vhs
# Run: vhs voicelayer-demo.tape
# Output: voicelayer-demo.gif (for README, social, posts)
#
# NOTE: This demo simulates the voice interaction visually.
# For a real demo video (with audio), use screen recording instead.

# Settings
Output voicelayer-demo.gif
Set FontSize 16
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 50ms
Set Shell "zsh"

# Scene 1: The concept
Sleep 500ms
Type "# VoiceLayer — 5 voice modes for AI coding agents"
Enter
Sleep 1s
Type "# No cloud APIs. No per-minute billing. Just local TTS + STT."
Enter
Sleep 1.5s

# Scene 2: Show the 5 modes
Type "# Modes:"
Enter
Sleep 300ms
Type "#   announce  — 'Build complete. 47 tests passing.'"
Enter
Sleep 300ms
Type "#   brief    — Agent reads back findings (slower pace)"
Enter
Sleep 300ms
Type "#   consult  — 'About to push. Want to review?'"
Enter
Sleep 300ms
Type "#   converse — Full voice Q&A (agent asks, you answer)"
Enter
Sleep 300ms
Type "#   think    — Silent notes to markdown log"
Enter
Sleep 1.5s

# Scene 3: Install
Type "# Add to Claude Code:"
Enter
Sleep 500ms
Type 'cat << EOF'
Enter
Type '  "mcpServers": {'
Enter
Type '    "qa-voice": {'
Enter
Type '      "command": "bunx",'
Enter
Type '      "args": ["voicelayer-mcp"]'
Enter
Type '    }'
Enter
Type '  }'
Enter
Type 'EOF'
Enter
Sleep 1.5s

# Scene 4: In-session usage simulation
Type "# In a Claude Code session:"
Enter
Sleep 500ms
Type "# Claude: qa_voice_announce('Build complete. 47 tests passing.')"
Enter
Type "#   -> [announce] Spoke: 'Build complete. 47 tests passing.'"
Enter
Sleep 1s
Type "# Claude: qa_voice_converse('How does navigation look on mobile?')"
Enter
Type "#   -> (speaks question... records your answer... transcribes)"
Enter
Type '#   -> "The hamburger menu is cut off on the right side"'
Enter
Sleep 1.5s

# Scene 5: Tech stack
Type "# Stack: edge-tts (TTS) + whisper.cpp (local STT)"
Enter
Type "# Session booking: lockfile mutex — one voice session at a time"
Enter
Type "# User stop: touch /tmp/voicelayer-stop (instant kill)"
Enter
Sleep 1s

# Scene 6: Tagline
Type "# Voice I/O for AI coding assistants."
Enter
Type "# github.com/EtanHey/voicelayer"
Enter
Sleep 3s
