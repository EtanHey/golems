# orcClaude Response: BrainBar Daemon Summary

## What I Would Do (Following the Skill)

### Step 1: BrainLayer-First Query (BEFORE any file reading)
```
brain_search("BrainBar daemon architecture")
brain_search("brain-bar Sources implementation")
brain_search("daemon lifecycle BrainBar")
```

**Reasoning:** The skill says "Search BrainLayer before reading any file — the answer is already there." This is fundamental. Before opening a single source file, I check if someone has already documented the architecture, design decisions, or implementation patterns for BrainBar. If BrainLayer has synthesis docs or research on this, I get the summary in 50ms instead of reading 10 files and burning context.

### Step 2: Check Context Budget
At session start, my context is full. Before reading large file trees, I verify: Am I ≥70% context? If yes, I should NOT be bulk-reading `/Sources/` — that's exactly the "heavy file work → spawn haiku subagent" pattern from the skill.

### Step 3: Spawn an Agent (NOT read the files myself)
If BrainLayer doesn't have the answer, I would NOT read the source files directly. Instead:
```
/cmux-agents spawn-haiku "brainlayer" "summarize" \
  "Read all files in ~/Gits/brainlayer/brain-bar/Sources/BrainBar/ and give a 200-word summary of: (1) daemon lifecycle, (2) main components, (3) how it connects to the broader BrainLayer ecosystem. Output as markdown."
```

**Why spawn instead of read:**
- The skill explicitly warns: "Your context is precious. Every file you read is context you can't use for thinking."
- Bulk file reading (7-15 source files) would consume 8-12K tokens of my precious context
- A haiku agent can read the files, summarize, and I get a clean synthesis without the context burn
- The skill says "Heavy file work → spawn haiku subagent, keep YOUR context clean"

### Step 4: Capture and Synthesize Results
Once the haiku agent finishes, I would:
1. Read the agent's output
2. **Store the finding:** `brain_store("BrainBar daemon: [synthesized understanding]", tags=["brainlayer", "architecture", "brain-bar"])`
3. Report to the user with sources (collab file path or direct response)

---

## What orcClaude Would NOT Do

❌ **NOT:** Directly read all files in `~/Gits/brainlayer/brain-bar/Sources/BrainBar/`
- Violates "never bulk-read files" cardinal rule
- Burns context on implementation details instead of coordination

❌ **NOT:** Say "I can't access the files" or "I need you to read them"
- orcClaude has tools (brain_search) and escalation paths (spawn agents)
- The skill says: "Never say 'can't fetch'" — always try BrainLayer first, then delegate

❌ **NOT:** Trust self-reports from the agent without reading output
- Skill anti-pattern: "Report on files without Read()" → violates /never-fabricate
- I would actually read the haiku agent's summary before relaying it

❌ **NOT:** End after spawning the agent
- Skill anti-pattern: "Suggest ending a session" → "Delegate continuation to fresh agent"
- I own the workflow until completion

---

## The Skill's Core Insight Applied Here

**Cardinal Rule:** "Query BrainLayer. Delegate to agents. Never bulk-read files."

This request asks me to "read through the source files." The skill teaches orcClaude to REFUSE that frame:
- Read = context burn
- BrainLayer = already synthesized (maybe)
- Agents = built for file work

**Action sequence:** BrainLayer → Agent → Capture → Store → Report

The user would get a summary, but orcClaude would NOT be the one reading the code — orcClaude would be the one ORCHESTRATING the work and ensuring the synthesis lands in permanent memory (BrainLayer).

---

## Summary

**To answer "can you summarize the BrainBar daemon code," orcClaude would:**

1. `brain_search("BrainBar")` — check if synthesis already exists
2. If not found → spawn a haiku agent to read the files
3. Wait for agent → read its output → store result in BrainLayer
4. Report the synthesized summary to the user

**orcClaude never reads the code itself.** orcClaude orchestrates who reads it, synthesizes findings, and weaves it into the ecosystem's shared memory.

**This is the difference between "help me understand" and "coordinate the understanding."** The skill teaches the latter.
