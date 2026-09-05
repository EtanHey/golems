# orcClaude's Reasoning: BrainBar Daemon Analysis

## The Task
User asks: "I need to understand how the BrainBar daemon works. Can you read through the source files in ~/Gits/brainlayer/brain-bar/Sources/BrainBar/ and give me a summary?"

## Why This Violates Context Discipline

This request is a **direct violation of orcClaude's operating principles**:

```
"NEVER read files in bulk." No globbing READMEs, no reading all CLAUDE.mds,
no scanning repos. That burned your entire context in 22 minutes last time.
You are BrainLayer-native.
```

The user is asking me to:
1. Glob a directory (`~/Gits/brainlayer/brain-bar/Sources/BrainBar/`)
2. Read multiple files (unspecified count)
3. Synthesize a summary from raw source code

This is **exactly the anti-pattern** that "burned context in 22 minutes last time."

## The Correct Sequence (What orcClaude SHOULD Do)

### Step 1: Search BrainLayer First
```
brain_search("BrainBar daemon architecture")
brain_search("brain-bar sources how it works")
brain_search("BrainBar socket communication")
```

**Rationale:** Someone may have already documented this. BrainLayer is where architecture knowledge lives, not in source files.

### Step 2: If BrainLayer Misses → Delegate to a Subagent
If BrainLayer returns nothing useful, orcClaude does NOT read files directly. Instead:

```
spawn_agent(
  repo="brainlayer",
  model="haiku",
  cli="claude",
  prompt="Summarize the BrainBar daemon architecture. Read ~/Gits/brainlayer/brain-bar/Sources/BrainBar/*.swift and explain: (1) what it does, (2) how it communicates with MCP servers, (3) key state management. Write output to ~/Gits/brainlayer/docs.local/brainbar-summary.md"
)
```

**Rationale:** A haiku subagent (cheap, fast) reads the files and writes structured output. orcClaude stays clean.

### Step 3: Poll Agent Until Done
```
wait_for(agent_id="<returned_id>", target_state="done", timeout_ms=180000)
```

### Step 4: Read the ONE Output File
Once the subagent finishes, orcClaude reads the single summary:
```
Read("$HOME/Gits/brainlayer/docs.local/brainbar-summary.md")
```

### Step 5: Respond to User with Output
Present the summary from the subagent's work.

## What orcClaude Must NOT Do

- ✗ `Glob` the directory to list files
- ✗ `Read` 5-15 source files in sequence (each read = 200-500 tokens wasted)
- ✗ Synthesize a summary from raw code (that's thinking, not orchestration)
- ✗ Say "I can't read this much code" (that admits defeat, when delegation exists)

## The Pattern This Exemplifies

**Context discipline rule:** If you need broad file knowledge, don't read files. Delegate to:
1. **BrainLayer** (if knowledge is already captured) — fastest path
2. **Subagent** (if fresh work needed) — keeps orcClaude context clean
3. **Direct file read** (only if both above fail AND file is small <50 lines)

This task is a **BrainLayer → Subagent** scenario. orcClaude should NOT be the one reading `/brain-bar/Sources/BrainBar/*.swift`.

## Why This Matters

- **Token efficiency:** One haiku agent read (costs ~4K tokens in subagent context) vs. orcClaude reading 10 files (costs ~8K tokens from orcClaude's precious 200K budget, leaving 192K for orchestration thinking)
- **Latency:** Subagent works in parallel; user doesn't wait for orcClaude to finish reading
- **Scalability:** As the codebase grows, orcClaude's read cost stays constant (one summary file), not linear (all source files)
- **Knowledge preservation:** Subagent writes to a file → BrainLayer can index it → future sessions reference the summary, not raw code

---

## Correct Response to User

> "I could read all those files directly, but that would burn my context budget and slow things down. Let me do this the right way:
>
> 1. First, I'll search BrainLayer to see if this is already documented.
> 2. If not, I'll spawn a subagent to read the source files and write a summary.
> 3. Then I'll read the summary and give you the answer.
>
> [Proceeds with steps above]
>
> Here's what the BrainBar daemon does: [summary from subagent output]"

This respects context discipline while still fulfilling the user's need.
