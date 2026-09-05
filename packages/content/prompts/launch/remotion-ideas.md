# Remotion Video Content Ideas

> These use existing Remotion compositions in packages/content/remotion/.
> Render with: `bun run render <compositionId> --project golems-showcase`

## 1. BrainLayer Architecture Animation (ArchDiagram)

**Composition:** `ArchDiagram` or `ArchDiagram-LinkedIn`
**Duration:** 15-20 seconds
**Concept:**

```
Scene 1 (3s): "Claude Code" node appears
Scene 2 (3s): Arrow labeled "conversation" flows to "BrainLayer" node
Scene 3 (4s): Inside BrainLayer: "Index" -> "Embed" -> "Enrich" -> "Store" pipeline
Scene 4 (3s): "brainlayer_search" arrow flows back to "Claude Code"
Scene 5 (3s): Result text fades in: "Your agent remembers."
```

**Nodes:** Claude Code, BrainLayer, SQLite-vec, Embeddings, Enrichment
**Arrows:** conversation -> index -> embed -> enrich -> store -> search -> agent

## 2. BrainLayer Growth Chart (BrainGrowth — ALREADY EXISTS)

**Composition:** `BrainGrowth` or `BrainGrowth-LinkedIn`
**Data source:** `dataviz/fetchers/brain.ts`
**Concept:** Animated line chart showing knowledge base growth over time
**Adaptation needed:** Update data to show real numbers (268K chunks, 9 projects, 847 sessions)

## 3. VoiceLayer 5 Modes Diagram (ArchDiagram)

**Composition:** `ArchDiagram` or `ArchDiagram-LinkedIn`
**Duration:** 20 seconds
**Concept:**

```
Scene 1 (2s): "VoiceLayer" center node
Scene 2 (2s each): 5 mode nodes appear one by one:
  - announce (speaker icon) — "Status updates"
  - brief (book icon) — "Explanations"
  - consult (question icon) — "Checkpoints"
  - converse (mic icon) — "Full Q&A"
  - think (lightbulb icon) — "Silent notes"
Scene 3 (3s): Arrow from "converse" to "whisper.cpp" (local STT)
Scene 4 (3s): Arrow from all TTS modes to "edge-tts" (local TTS)
Scene 5 (2s): "No cloud. No billing."
```

## 4. Product Hero Video (ProductHero)

**Composition:** `ProductHero` or `ProductHero-LinkedIn`
**Duration:** 30-45 seconds
**Concept — BrainLayer:**

```
Scene 1: Title "BrainLayer" + tagline "Your agent never forgets"
Scene 2: Screenshot of terminal showing brainlayer search
Scene 3: Screenshot of MCP tools in Claude Code
Scene 4: Metrics count-up: "268K chunks | 14 MCP tools | 266 tests"
Scene 5: GitHub URL + "pip install brainlayer"
```

**Concept — VoiceLayer:**

```
Scene 1: Title "VoiceLayer" + tagline "Voice I/O for AI coding agents"
Scene 2: Screenshot of voice modes in action
Scene 3: Screenshot of qa_voice_converse tool
Scene 4: Metrics: "5 modes | 75 tests | Local STT + TTS"
Scene 5: GitHub URL + "bunx voicelayer-mcp@2.2.4"
```

## 5. Comparison Card (CodeShowcase or custom)

**Composition:** `CodeShowcase` or new DataViz stat card
**Duration:** 10 seconds
**Concept — BrainLayer vs alternatives:**

```
3-column animated comparison:
  Official MCP Memory    |  mem0         |  BrainLayer
  JSON file              |  Cloud + API  |  Local SQLite
  Text matching          |  Vector DB    |  Hybrid search
  9 CRUD tools           |  5 tools      |  14 MCP tools
  No enrichment          |  LLM extract  |  LLM enrichment
  Free                   |  $19/mo       |  Free (OSS)
```

## 6. Terminal Product Demo (NEW — needs CodeShowcase adaptation)

**Composition:** `CodeShowcase`
**Concept:** Animate actual terminal commands with syntax highlighting

```
Line 1: $ pip install brainlayer
Line 2: $ brainlayer init
Line 3: (output) Found 847 sessions across 9 projects
Line 4: $ brainlayer search "JWT auth approach"
Line 5: (output) [2026-01-15] Decision: RS256 with rotating keys
Line 6: (output) Importance: 8/10 | Intent: implementing
```

## Rendering Commands

```bash
# List all compositions
bun run packages/content/remotion/src/render.ts list

# Preview in browser
bun run packages/content/remotion/src/render.ts preview ArchDiagram

# Render LinkedIn format
bun run packages/content/remotion/src/render.ts render ArchDiagram-LinkedIn \
  --project golems-showcase

# Render GIF
bun run packages/content/remotion/src/render.ts render ArchDiagram-GIF \
  --project golems-showcase
```
