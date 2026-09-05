# Twitter/X — BrainLayer Demo Thread

> Post from: @EtanHey
> Format: 5-8 tweet thread
> First tweet: MUST include demo GIF (auto-plays)
> Time: Same day as Show HN or day after

## Thread

### Tweet 1 (Hook + GIF)

AI coding agents have amnesia.

Every session starts from zero. Every decision forgotten. Every debugging session lost.

I built an open-source fix: BrainLayer

268K+ conversation chunks. 14 MCP tools. 100% local.

[DEMO GIF]

### Tweet 2 (The problem)

After 2 years of Claude Code, I had 847 coding sessions across 9 projects.

Hundreds of architecture decisions. Thousands of debugging insights.

All trapped in transcript files that Claude couldn't access.

### Tweet 3 (The solution)

BrainLayer indexes your Claude Code sessions into a local SQLite-vec database.

Hybrid search: semantic embeddings (bge-large-en-v1.5) + FTS5 keyword search.

Under 100ms for 268K chunks.

### Tweet 4 (How it works)

Three commands to get started:

```
pip install brainlayer
brainlayer init
brainlayer index
```

Then add one line to your Claude Code config.

Now your agent has persistent memory across every session.

### Tweet 5 (What makes it different)

vs. official MCP memory server: JSON file + text matching
vs. mem0: requires OpenAI API key + cloud account

BrainLayer: local SQLite, no API keys, hybrid search, LLM enrichment.

Your data never leaves your machine.

### Tweet 6 (The enrichment magic)

The enrichment pipeline runs a local LLM (Ollama/MLX) on each session:

- Extracts decisions, corrections, learnings
- Tags with importance (1-10) and intent
- Generates searchable summaries

Your agent doesn't just remember — it understands.

### Tweet 7 (CTA)

BrainLayer is open source (Apache 2.0).

GitHub: github.com/EtanHey/brainlayer
Docs: etanhey.github.io/brainlayer

14 MCP tools. 266 tests. Works with Claude Code, Cursor, VS Code.

Sister project: VoiceLayer (voice I/O for coding agents)

---

## Notes for Etan

- First tweet MUST have a demo GIF — threads without media get buried
- Keep each tweet under 280 chars
- Quote-tweet the first tweet from your main profile for extra reach
- Tag @simonw, @swyx, @alexalbert__ if relevant (they're active in MCP space)
- Don't ask for retweets — just make it good
- "Building in public" follow-up tweets (1-2 per week) keep momentum going
