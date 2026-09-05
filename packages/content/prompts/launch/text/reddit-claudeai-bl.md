# Reddit r/ClaudeAI — BrainLayer

> Post to: https://reddit.com/r/ClaudeAI
> Flair: "Built with Claude" or "Show & Tell"
> Include: demo GIF (from VHS tape)
> Time: Afternoon (after HN post has traction)

## Title

I fixed Claude Code's amnesia — 268K chunks of my own coding history, all searchable in under 100ms

## Body

After months of Claude Code forgetting every architecture decision, every debugging session, every preference I've ever expressed, I built a persistent memory layer.

**BrainLayer** indexes your Claude Code conversation transcripts into a local SQLite database with hybrid semantic + keyword search. It exposes 14 MCP tools that your agent uses automatically.

[DEMO GIF HERE]

**What it does:**
- Indexes your actual Claude Code session history (not just notes you write)
- Hybrid search: vector embeddings (bge-large-en-v1.5) + FTS5 keyword search
- 14 MCP tools including search, think, recall, store, file timeline, regression detection, session summaries
- LLM enrichment: auto-generates summaries, tags, importance scores per conversation chunk
- Runs 100% locally. No cloud. No API keys. Single-file SQLite.

**Quick start:**
```
pip install brainlayer
brainlayer init
brainlayer index
```

Then add to your Claude Code config:
```json
{
  "mcpServers": {
    "brainlayer": { "command": "brainlayer-mcp" }
  }
}
```

Now when you ask "how did I implement auth last month?" — your agent actually knows.

I've been using this for 2 months with 268K+ indexed chunks across 9 projects. The difference is night and day. Claude remembers past decisions, catches when I'm about to repeat a mistake, and references debugging sessions from weeks ago.

GitHub: https://github.com/EtanHey/brainlayer
Docs: https://etanhey.github.io/brainlayer/

Happy to answer any questions about the architecture or how it compares to mem0 (different tools for different problems — mem0 is for app-level agent memory, BrainLayer indexes your own coding session history).

---

## Notes for Etan

- r/ClaudeAI loves "I built X" posts with a real demo
- The "amnesia" framing is proven resonant on this sub
- Don't trash mem0 — say "different problems, different solutions"
- If people ask about Cursor/VS Code support: MCP works with any MCP client
- Expect questions about privacy (all local), storage size (~1.4GB for 268K chunks), search quality
