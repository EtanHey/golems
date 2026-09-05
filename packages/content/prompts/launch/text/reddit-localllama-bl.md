# Reddit r/LocalLLaMA — BrainLayer

> Post to: https://reddit.com/r/LocalLLaMA
> This audience cares about: local-first, no cloud, no API keys, open weights
> Include: demo GIF + architecture diagram

## Title

Built a persistent memory layer for AI coding agents — 100% local, SQLite-vec + bge-large, local LLM enrichment via Ollama

## Body

I built BrainLayer to give AI coding agents persistent memory without touching any cloud API.

**Architecture:**
- **Storage:** sqlite-vec (vector extension for SQLite, single-file database)
- **Embeddings:** bge-large-en-v1.5 (1024 dimensions, runs locally via sentence-transformers)
- **Search:** Hybrid — cosine similarity on vectors + FTS5 keyword search, results merged with RRF
- **Enrichment:** Local LLM (Ollama with GLM-4.7-Flash or MLX) generates summaries, tags, importance scores, intent classification per chunk
- **Scale:** 268K+ chunks indexed, search latency < 100ms

No OpenAI. No Anthropic API key for core operation. No data leaving your machine.

**How it works:**
1. `brainlayer index` — scans Claude Code session transcripts, chunks them, embeds them
2. `brainlayer-mcp` — MCP server exposes 14 tools to any MCP client
3. Agent calls `brainlayer_search("JWT auth approach")` mid-session and gets back past decisions
4. `brainlayer_store` — agent can persist new memories (decisions, learnings, mistakes)
5. `brainlayer enrich-sessions` — local LLM analyzes sessions for decisions, corrections, patterns

**Enrichment backend auto-detection:**
- Apple Silicon (arm64 Darwin) → MLX (fastest)
- Ollama available → Ollama with GLM-4.7-Flash
- Neither → skips enrichment (core search still works)

The enrichment pipeline processes ~13s/chunk on M1 Pro with GLM-4.7-Flash, or ~5s with MLX.

**Why sqlite-vec:**
- Single-file database (no Postgres, no Docker, no separate service)
- WAL mode for concurrent read/write from daemon, MCP server, and enrichment
- Surprisingly fast — 268K vectors searched in < 100ms with HNSW-style ANN

GitHub: https://github.com/EtanHey/brainlayer
Python 3.11+, Apache 2.0, 266 tests.

Would love feedback from anyone running local embedding models — especially if you've benchmarked bge-large vs nomic-embed or e5-large for code/conversation retrieval.

---

## Notes for Etan

- r/LocalLLaMA wants technical depth — model names, dims, benchmarks
- Lead with "100% local" — this is the community's core value
- Mentioning sqlite-vec specifically will resonate (it's a known project)
- The Ollama + GLM-4.7-Flash stack is familiar to this audience
- Ask for feedback at the end — this community loves discussing embedding model choices
- If asked about multilingual support: bge-large handles English well, multilingual would need bge-m3
