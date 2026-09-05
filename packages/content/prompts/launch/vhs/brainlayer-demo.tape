# BrainLayer Demo — Terminal GIF
# Install VHS: brew install vhs
# Run: vhs brainlayer-demo.tape
# Output: brainlayer-demo.gif (for README, social, posts)

# Settings
Output brainlayer-demo.gif
Set FontSize 16
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 50ms
Set Shell "zsh"

# Scene 1: The problem — Claude forgets
Sleep 500ms
Type "# Claude Code forgets everything between sessions..."
Enter
Sleep 1s
Type "# What approach did we use for auth? What was that bug fix?"
Enter
Sleep 1s
Type "# Let's fix that."
Enter
Sleep 1.5s

# Scene 2: Install BrainLayer
Type "pip install brainlayer"
Enter
Sleep 2s

# Scene 3: Initialize
Type "brainlayer init"
Enter
Sleep 1.5s

# Simulate init output
Type "# Scanning for Claude Code sessions..."
Enter
Sleep 500ms
Type "# Found 847 sessions across 9 projects"
Enter
Sleep 500ms
Type "# Embedding model: bge-large-en-v1.5 (1024 dims)"
Enter
Sleep 500ms
Type "# Database: ~/.local/share/brainlayer/brainlayer.db"
Enter
Sleep 1s

# Scene 4: Index sessions
Type "brainlayer index"
Enter
Sleep 1s
Type "# Indexing... 268,421 chunks indexed"
Enter
Sleep 1.5s

# Scene 5: Search — the magic moment
Type "brainlayer search 'how did I implement JWT auth'"
Enter
Sleep 2s

# Simulate search results
Type "# [Session 2026-01-15] golems/packages/shared"
Enter
Type "#   Decision: RS256 with rotating keys, 15min access + 7d refresh"
Enter
Type "#   Importance: 8/10 | Intent: implementing"
Enter
Sleep 500ms
Type "# [Session 2026-01-12] golems/packages/claude"
Enter
Type "#   Learning: Always strip ANTHROPIC_API_KEY from env when spawning"
Enter
Type "#   Importance: 9/10 | Intent: debugging"
Enter
Sleep 2s

# Scene 6: MCP integration
Type "# Add to Claude Code config — one line:"
Enter
Sleep 500ms
Type 'echo '"'"'{"mcpServers":{"brainlayer":{"command":"brainlayer-mcp"}}}'"'"''
Enter
Sleep 1.5s

# Scene 7: Tagline
Type "# Your AI agent never forgets again."
Enter
Type "# github.com/EtanHey/brainlayer"
Enter
Sleep 3s
