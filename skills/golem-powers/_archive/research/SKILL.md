---
name: research
description: Deep web research orchestrator. Routes research tasks to the best backend — internal subagents, CLI agents (Gemini/Cursor), or the researcher subagent. Use when asked to research, investigate, compare, find alternatives, or deep-dive into any topic. Covers web research, company research, code pattern research, and pre-implementation research.
---

# Research Skill

Multi-backend research orchestrator. Routes to the cheapest effective tool for each task.

## Modes

| Command | Backend | Cost | Sources | Time | Best For |
|---------|---------|------|---------|------|----------|
| `/research "topic"` | Researcher subagent | $0 (subscription) | 15-25 | 3-5 min | General web research |
| `/research --quick "topic"` | WebSearch + WebFetch (inline) | $0 | 5-8 | 1-2 min | Quick lookups |
| `/research --deep "topic"` | Researcher subagent (max depth) | $0 | 40-80 | 10-20 min | Comprehensive research |
| `/research --company "name"` | Exa company_research | Free credits | 10-15 | 2-3 min | Company/product intel |
| `/research --code "pattern"` | CLI agents swarm (Gemini) | $0 | N/A | 3-5 min | Code patterns, library comparison |
| `/research --paper "topic"` | research-paper-analyst agent | $0 | arXiv | 5-10 min | Academic papers |
| `/research --audit "repo/code"` | CLI agents (Gemini + Cursor) | $0-20/mo | N/A | 5-10 min | Code audit, pre-PR review |
| `/research --external "topic"` | CLI agents (Gemini) | $0 | Web | 3-5 min | Offload from Opus context |
| `/research --unified "topic" --project <name>` | Claude Web + Gemini Drive-backed dispatch | $0 | Shared Drive context | 5-15 min | Paired cross-platform research on identical inputs |

## Workflow: Default Research

0. **Research prompt gate** — before `--deep` or external research dispatch, run `/research-prompt-quality` (CHECK-FIRST + GROUND). Do not ship flat or redundant prompts.
1. **Check BrainLayer first** — `brain_search(query)` may already have what you need
2. **Launch researcher subagent** in background:
   ```
   Task(subagent_type: "researcher", prompt: "Research: {topic}", run_in_background: true)
   ```
3. **Continue working** while research runs
4. **Read results** when notified — researcher saves to `docs.local/research/[date]-[slug].md`
5. **Digest to BrainLayer** if worth keeping: `brain_digest(content)` then delete the file

## Workflow: Quick Research (inline)

No subagent — run directly in current context:

1. Run 3-5 `WebSearch` queries in parallel
2. `WebFetch` top 3-5 results
3. Synthesize inline
4. Continue working

Use when you need a quick answer, not a report.

## Workflow: Company Research

For job leads, freelance prospects, meeting prep:

1. `company_research_exa(company_name)` — get company overview
2. `web_search_exa("company_name funding team size tech stack")` — deeper intel
3. `brain_search("company_name")` — check if we've seen them before
4. Output structured brief:
   - What they do (1 sentence)
   - Tech stack / relevant tech
   - Recent news / funding
   - Connection to our skills
   - Red flags

## Workflow: Code Research

For library comparison, pattern discovery, architecture decisions:

1. **BrainLayer check**: `brain_search("topic")` — past decisions?
2. **Exa code context**: `get_code_context_exa("pattern/library")` — real code examples
3. **CLI agent (Gemini)**: `run.sh gemini "Compare X vs Y for [use case]"` — free, detailed analysis
4. **Optional: Cursor audit**: `run.sh cursor "Review this code pattern: ..."` — GPT-5.2 perspective

## Workflow: External Research (offload from Opus)

When the main Claude Code session is expensive Opus and you want cheap research:

```bash
# Gemini does the research, saves to file (FREE)
~/.claude/commands/cli-agents/scripts/run.sh gemini "Research: {full prompt}" docs.local/research/$(date +%Y%m%d)-research.md
```

Then read the output file. Gemini is free (1K/day) and good for general research.

## Workflow: Deep Research (Claude Web-quality)

For comprehensive research matching Claude Web's 463-source depth:

1. **Launch researcher subagent** with explicit depth:
   ```
   Task(subagent_type: "researcher", prompt: "COMPREHENSIVE deep research on: {topic}. Target 40+ sources. Run 25+ search queries. Cross-reference all claims.", run_in_background: true)
   ```
2. **Supplement with CLI agents** for extra perspectives:
   ```bash
   run.sh gemini "Deep research on {topic} — focus on {angle A}" /tmp/research-gemini.md
   ```
3. **Merge results** — researcher report + Gemini output = comprehensive coverage
4. **Store in BrainLayer** — `brain_store` the synthesis for future retrieval

## Workflow: Pre-PR Audit

Extra eyes before PR loop:

1. **Gemini review**: `run.sh gemini "Review this diff for bugs, security issues, and missed edge cases: $(git diff main..HEAD)"` — free
2. **Cursor review**: `run.sh cursor "Audit this code change: ..."` — GPT-5.2 perspective
3. **Both in parallel** — compare their findings
4. Fix issues before pushing

## Workflow: Unified Multi-Platform Research

Use this when you want Claude Web and Gemini to research the same question against the same Drive-backed context.

1. Verify the project folders exist in Drive:
   ```bash
   python3 skills/golem-powers/research/_shared/drive-paths.py ensure-project-folders <project>
   ```
2. Compute the shared dispatch plan:
   ```bash
   bash skills/golem-powers/research/scripts/unified-dispatch.sh --project <project> --topic "Compare BrainLayer vs Mem0 for long-term memory"
   ```
3. Dispatch Claude Desktop with the shared Drive project:
   - `/claude-desktop-research` (was `/claude-web-research` — renamed 2026-04-30; alias active until 2026-05-30)
   - reads `Drive/Research/<project>/context/`
   - writes `Drive/Research/<project>/results/R{NN}-claude-desktop-result.md`
4. Dispatch Gemini with the same Drive project:
   - `/gemini-research`
   - reads the identical Drive folder ID for `Drive/Research/<project>/context/`
   - writes `Drive/Research/<project>/results/R{NN}-gemini-result.md`
5. Hand the paired results to `/research-ab-test` without platform guessing.

Example:

```bash
/research --unified "Compare BrainLayer vs Mem0 for long-term memory" --project brainlayer
```

Unified mode is successful only when both dispatches reference the same Drive folder ID and produce pre-attributed paired result paths.

## Integration Points

| System | How Research Connects |
|--------|----------------------|
| `/large-plan` | Research phases auto-route here. Plan scaffold includes research tasks per phase |
| `/architectural-conformance-audit` | Pre-R0 sprint gate: feed the research output through the audit before any sprint hooks fire. Surfaces cited counter-examples vs impl mismatches |
| `/gemini-research` | Gemini Deep Research and NotebookLM MCP workflows when the task needs notebook-backed synthesis |
| `/jobs` pipeline | Company research before applying. `--company` mode |
| Gems pipeline | Research-backed gem discovery via `--paper` mode |
| Meeting notes | Pre-meeting research on participants/companies |
| PR loops | Pre-PR code audit via `--audit` mode |
| BrainLayer | All research results stored for future retrieval |

## Cost Summary

| Backend | Cost | Limit |
|---------|------|-------|
| WebSearch/WebFetch | $0 (included in subscription) | Unlimited |
| Exa | Free credits (2K one-time) | Then $5/1K |
| Gemini CLI | $0 | 1K requests/day |
| Researcher subagent | $0 (subscription) | Context window |
| Cursor CLI | $20/mo (Cursor Pro) | Unlimited |
| research-paper-analyst | $0 (subscription) | Context window |

**Default stack is 100% free**: WebSearch + Exa free credits + Gemini CLI.

## Output Location

| Type | Location |
|------|----------|
| Quick research | Inline (no file) |
| Standard research | `/tmp/research-[slug].md` (ephemeral) |
| Worth keeping | `docs.local/research/[date]-[slug].md` |
| BrainLayer | Auto-stored via `brain_store` |

## Future: n8n Deep Research Pipeline

When n8n orchestrator is set up (`packages/orchestrator`), add:
- Scheduled research (e.g., weekly job market scan)
- 400+ source deep research via recursive search loops
- Automated BrainLayer ingestion of research results
- Research templates (company intel, tech comparison, market scan)

Template exists: [n8n deep research workflow](https://n8n.io/workflows/2878)
