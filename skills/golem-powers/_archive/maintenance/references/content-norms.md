# Content Norms Reference

> Universal rules that apply across all content types, plus quick-reference summaries per type.
> See also: `/content` skill (ClaudeGolem voice, content types, anti-hype rules) and `/linkedin-post` skill (Aviv Levi's 2026 algorithm rules).

## Universal Rules

### 1. Specifics Over Adjectives
- YES: "209KB native binary replaces 10 Python processes (931MB)"
- NO: "Lightweight, high-performance daemon solution"

### 2. No Hype Words
Never use: revolutionary, cutting-edge, state-of-the-art, game-changing, blazing fast, best-in-class, next-generation, seamless, robust, scalable (without numbers).

Replace with: specific measurements. "Search responds in <500ms" not "blazing fast search."

### 3. Honest About Gaps
- If something is WIP: "Planned: vector search via CoreML (currently FTS5-only)"
- If something has limits: "Handles 312K chunks. Vector scaling beyond 1M is an open question."
- If AI agents did the work: "Designed the architecture and orchestrated 3 AI agents to implement in parallel"

### 4. Show the Delta
Before/after is always more compelling than current state alone:
- "10 Python processes (931MB) -> 1 Swift daemon (40MB)" beats "40MB daemon"
- "3/8 GREEN (37.5%) -> 6/8 GREEN (75%)" beats "75% test pass rate"
- "p50 1480ms -> p50 450ms" beats "Fast search"

### 5. Developer Audience
Write for people who:
- Read source code
- Can smell bullshit
- Value precision over enthusiasm
- Judge by evidence, not claims
- Respect honest limitations more than perfect marketing

### 6. AI Collaboration Is a Feature
The ecosystem uses AI agents extensively. This is a strength:
- "Orchestrated 3 parallel AI agents to implement daemon architecture" = impressive
- "Built a system where AI agents coordinate via BrainLayer memory" = interesting
- Hiding AI involvement is dishonest and misses the best story

---

## Per-Type Quick Reference

### README
- Section order: title -> metrics -> why -> architecture -> quickstart -> examples -> config -> dev -> status
- Quick start must be copy-paste ready
- Architecture prefers diagrams over prose
- Max length: aim for <300 lines. If longer, split into separate docs.

### Portfolio Page
- Hero: name + one-liner + key visual
- The Numbers section is what recruiters scan
- My Role: specific attribution (designed/implemented/orchestrated)
- Lessons Learned: genuine insights only, skip if nothing real to say
- Frame scope honestly: "personal developer infrastructure" not "platform"

### Skill Page
- Lead with the delta (with-skill vs without-skill)
- Eval results with actual assertion names, not just percentages
- Model support must be honest about capability gaps
- Never fabricate eval results — show "not yet tested" instead
- Show what the AI sees (tool interface), not the full prompt

### Resume
- XYZ formula: Accomplished [X] as measured by [Y], by doing [Z]
- Every bullet has a number
- Max 4 bullets per project
- Action verbs, no passive voice
- Technology in context, not as a comma-separated list

### LinkedIn
- Hook in first 2 lines (before "see more" fold)
- One idea per post
- Short paragraphs (1-2 sentences)
- Max 3 hashtags
- No cringe openers or fake vulnerability
- Hebrew posts: no em dashes, casual Israeli tech tone

### Docs
- One question per page
- Current state first, plans labeled explicitly
- Code blocks over prose for anything expressible as code
- Date-stamp specific metrics
- Verify all file paths and links exist
