---
name: orchestrator-status
description: |
  Ecosystem-wide status collection and orientation. Use when returning to work, starting a new session,
  when the user says "where were we", "what's the status", "catch me up", "what happened",
  or any time you need to understand the current state across projects. This is NOT the repo-scoped
  /catchup (git diffs) — this is the orchestrator-level "what's happening across the whole ecosystem."
  Also use when you need to prepare a research prompt — this skill gathers all the context needed
  to write a detailed, self-contained prompt for a research agent.
---

# Orchestrator Status — Ecosystem Orientation

Quickly orient yourself across the entire golems ecosystem: what's active, what's done, what's blocked, what needs research. This replaces the pattern of reading random files and hoping for context.

## When to Use

- **Session start** — "where were we?"
- **Returning from a break** — "what happened while I was gone?"
- **Before delegating** — gather context for a research/worker prompt
- **User gives vague direction** — need to figure out what they mean from ecosystem state
- **Cross-project coordination** — need to know state of multiple repos

This is the ORCHESTRATOR-level catchup. For single-repo git status, use `/catchup`.

## The Flow (5 steps, ~60 seconds)

### Step 1: BrainLayer Context (5 seconds)

```
brain_recall(mode="context")          # What's happening right now
brain_recall(mode="summary")          # High-level ecosystem state
```

If the user mentioned a specific topic, also:
```
brain_search("<topic>")               # What do we know about this
brain_search("<topic> decision")      # Past decisions on this
```

### Step 2: Roadmap (10 seconds)

Read the single source of truth:
```
Read $ORCHESTRATOR_REPO/roadmap/README.md
```

Focus on the "What's Next?" section at the top. This tells you:
- Active wave and tracks
- Which tracks are DONE vs IN PROGRESS vs BLOCKED
- What's queued for next wave

### Step 3: Latest Commits (10 seconds)

Check git log across active repos. Only check repos mentioned in the active wave:
```bash
cd ~/Gits/golems && git log --oneline -5
cd ~/Gits/brainlayer && git log --oneline -5
cd $ORCHESTRATOR_REPO && git log --oneline -5
```

### Step 4: Active Collabs (15 seconds)

Read the collab files for the current wave:
```
Glob $ORCHESTRATOR_REPO/collab/wave*-*.md
```

Read each one — focus on: Status line, last message, blockers. Collabs are the communication channel between agents.

### Step 5: Design Doc (20 seconds)

Read the design doc for the most relevant active track. The roadmap's "Design Docs Index" section links them all. Only read the first 40-60 lines (problem + schema) — don't read the whole thing unless needed.

## Output: Status Synthesis

After the 5 steps, synthesize into a brief status report:

```
**Wave N Status:**
| Track | Status | Latest | Next |
|-------|--------|--------|------|
| A: ... | DONE/IN PROGRESS/BLOCKED | PR #X / commit | What's next |

**Active design doc:** designs/X.md — [one line summary of where it is]
**Blockers:** [any blockers from collabs]
**Research needed:** [if any track needs research, describe what]
```

## When Research Is Needed

If a track needs information you don't have (external platform capabilities, library APIs, architecture patterns), prepare a research prompt. The prompt must be:

1. **Self-contained** — the research agent has zero context. Include ALL relevant background.
2. **Specific** — list exact questions, not vague "research X"
3. **Structured** — tell the agent what output format you want
4. **Scoped** — tell it what to search for and where

Use the `/research` skill or spawn a researcher subagent. For library/API docs, use context7 MCP first.

### Research Prompt Template

```
## Deep Research: [Topic] for [Project]

### Context — What We're Building
[2-3 paragraphs explaining the ecosystem, the specific project, and WHY this research matters]

### The Active Design Doc / Decision
[Summary of the design doc that needs this research input]

### What We Need to Know
[Numbered list of specific questions, grouped by subtopic]

### Output Format
[Exact structure of the report you want]

### Search Strategy
[Specific search terms, sites to check, types of sources]

### Important
[Constraints, anti-patterns, what NOT to research]
```

## Anti-Patterns

- **Don't read all CLAUDE.mds** — that's what killed context in 22 minutes. Use BrainLayer.
- **Don't bulk-read collabs from old waves** — only read the ACTIVE wave.
- **Don't check repos not in the active wave** — irrelevant context burn.
- **Don't do research yourself when you can delegate** — your context is precious.
- **Don't guess ecosystem state** — always check. Things change between sessions.

## Relationship to Other Skills

| Need | Use |
|------|-----|
| Single-repo git status | `/catchup` |
| Ecosystem-wide orientation | **This skill** |
| Detailed web research | `/research` |
| Library/API docs | `context7` MCP |
| BrainLayer troubleshooting | `/brainlayer` |
