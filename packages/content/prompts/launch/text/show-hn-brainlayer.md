# Show HN: BrainLayer

> Post to: https://news.ycombinator.com/submit
> Best time: Tuesday-Thursday, 9-11am ET
> Link to: GitHub repo (not docs site)
> Be in comments for first 6 hours

## Title

Show HN: BrainLayer -- Persistent memory for AI coding agents (14 MCP tools, local SQLite)

## First Comment (post immediately after submission)

Hi HN, I built BrainLayer because Claude Code forgets everything between sessions.

Every architecture decision, every debugging session, every preference I've expressed -- gone the moment I start a new conversation. After months of repeating myself, I built a memory layer.

**How it works:**
- Indexes Claude Code conversation transcripts into a local SQLite database
- Hybrid search: sentence-transformers (bge-large-en-v1.5, 1024 dims) + FTS5 keyword search via sqlite-vec
- 14 MCP tools including search, think, recall, store, file timeline, regression detection, session summaries, and more
- LLM enrichment pipeline: auto-generates summaries, tags, importance scores, intent classification per chunk
- Runs 100% locally. No cloud. No API keys for core operation. Single-file SQLite database.

I've indexed 268K+ chunks from 2 years of my own coding sessions across 9 projects. Search latency is under 100ms.

**What makes this different from mem0:** mem0 is a memory platform for application agents (needs OpenAI API key, cloud account, $19/mo managed tier). BrainLayer indexes YOUR actual coding session history into a local database. Different problem, different solution.

**What makes this different from the official MCP memory server:** The official server stores entities in a JSON file with text matching. BrainLayer uses vector embeddings, hybrid search, and LLM enrichment at scale.

Quick start: `pip install brainlayer && brainlayer init && brainlayer index`

GitHub: https://github.com/EtanHey/brainlayer
Docs: https://etanhey.github.io/brainlayer/

Built with Python, sqlite-vec, sentence-transformers, MCP SDK. Apache 2.0. 266 tests.

Happy to answer any questions about the architecture, search quality, or embedding choices.

---

## Notes for Etan

- Keep title under 80 chars, no exclamation marks, no emoji
- HN rewards specificity ("14 MCP tools, local SQLite") over vagueness
- First comment must be substantial -- this is where you tell the story
- Don't say "we" -- it's a solo project, own it
- Be ready to discuss: Why sqlite-vec over pgvector? Why bge-large over OpenAI embeddings? How does enrichment work?
- If someone asks about graph memory or temporal awareness -- acknowledge as roadmap items
- Respond to every comment, especially critical ones. HN respects builders who engage.
