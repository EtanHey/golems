---
name: figma-swarm
description: Multi-agent Figma screen decomposition and component build pipeline. Use when implementing multiple screens from Figma designs, breaking down screens into components, mapping to existing component library, and coordinating parallel builds. Triggers on "decompose screens", "build from Figma", "screen components", "figma swarm", "component mapping", "design to components", or when the user shares multiple Figma screen node IDs for implementation. Also use when re-checking for design drift against Figma.
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "components/**/*.ts"
  - "collab/figma-swarm/**"
---

# Figma Swarm — Multi-Agent Screen Decomposition & Build

> Decompose Figma screens into components, map to your existing library, negotiate shared components across screens, build what's missing, and verify everything with figma-loop.

## When to Use

- Implementing a set of screens from Figma (e.g., "build the profile section")
- Breaking down a Figma page into reusable components before building
- Coordinating multiple agents building different screens that share components
- Re-running to detect design drift (Figma changed since last build)

## How It Works

An **orchestrator Claude** (you) spawns one **screen agent** per Figma screen via `/cmux-agents`. Each agent decomposes its screen, maps components to the local library, and flags what needs building. Shared components are resolved through a consensus protocol — no duplicates, no conflicts. Once mapping is complete, the orchestrator reviews, consults the user, and creates Linear issues.

```
Orchestrator (you)
├── Screen Agent A (Personal Details)
├── Screen Agent B (Link Accounts)        ←── collab/figma-swarm/<project>/
├── Screen Agent C (Search Preferences)
└── Screen Agent D (Account Settings)
     │
     ├── component-needed.md   ← shared registry (claims + status)
     └── mailbox/messages.jsonl ← message passing (orchestrator ↔ agents)
```

## Prerequisites

| Tool | Purpose |
|------|---------|
| Figma MCP (`mcp__figma__get_screenshot` or `mcp__figma-remote__get_screenshot`) | Extract screen screenshots and component details |
| `/cmux-agents` skill | Spawn and manage parallel screen agents |
| `/figma-loop` skill | Pixel-perfect verification per component |
| Component inventory files | Know what's already built (e.g., `ui-web-inventory.md`, `ui-native-inventory.md`) |

## Quick Actions

| What you want | Workflow |
|---------------|----------|
| Full pipeline (decompose → map → build → verify) | [workflows/orchestrate.md](workflows/orchestrate.md) |
| Set up collab folder for a project | [workflows/setup.md](workflows/setup.md) |
| Screen agent: decompose + map one screen | [workflows/screen-agent.md](workflows/screen-agent.md) |
| Resolve shared component conflicts | [workflows/consensus.md](workflows/consensus.md) |
| Re-check for design drift | [workflows/drift.md](workflows/drift.md) |

---

## The Pipeline

### Phase 1: Setup

Create the collab folder structure and gather inventories.

```
collab/figma-swarm/<project>/
├── component-needed.md    # Shared component registry
├── component-map.md       # Final mapping (component → local file)
├── mailbox/
│   └── messages.jsonl     # JSON Lines: {to, from, type, body, read_by: []}
└── screens/
    ├── screen-a.md        # Per-screen decomposition
    └── screen-b.md
```

**Before spawning agents, the orchestrator must:**
1. Identify all screens to decompose (Figma node IDs)
2. Locate the project's component inventory (built components list)
3. Locate any reuse maps or design token files
4. Create the collab folder structure
5. Seed `component-needed.md` with header and empty table

### Phase 2: Decompose (parallel — one agent per screen)

Spawn screen agents via `/cmux-agents`. Each agent's task:

1. **Screenshot** — Get Figma screenshot of their screen via MCP
2. **Extract** — List every visible component: buttons, inputs, cards, labels, icons, drawers, sheets
3. **Measure** — For each component: dimensions, position (x/y from parent), padding/margins, colors, typography, border radius
4. **Map** — Check each against the component inventory:
   - **Matched**: component exists locally → record file path + any prop differences
   - **Close match**: similar component exists but needs variant/state → flag for consolidation review
   - **Missing**: no local equivalent → add to `component-needed.md` with Figma specs
5. **Write** — Save decomposition to `collab/figma-swarm/<project>/screens/<screen-name>.md`

### Phase 3: Shared Component Resolution (consensus protocol)

After all agents finish decomposition, shared components need negotiation. This is the most important part — it prevents duplicate work and ensures consistency.

See [workflows/consensus.md](workflows/consensus.md) for the full protocol. Summary:

**Claim flow:**
1. Agent checks `component-needed.md` for unclaimed components it needs
2. Agent writes a claim: `| StatusBadge | Agent-B | CLAIMED | specs... |`
3. Agent waits ~90 seconds, re-reads the file
4. If no conflict → agent owns it
5. If conflict (two agents claimed same component) → negotiate via mailbox

**2-straight-consensus-loops rule:**
For shared components (needed by 2+ agents), all interested parties must agree on the spec **twice in a row** before anyone builds. This ensures:
- Everyone has seen the proposed design
- No one wants changes after the first agreement
- Components that appear on multiple screens look consistent

**Variant consolidation:**
When two agents have similar-but-not-identical components (e.g., a StatusTag with blue vs purple), they should consider:
- Can this be one component with a `variant` or `colorScheme` prop?
- Is it a wrapper pattern (like BottomDrawer wrapping different content)?
- Flag these to the orchestrator for a decision if unsure

### Phase 4: Build (parallel)

Once claims are resolved:
- Each agent builds their claimed components
- Each agent runs `/figma-loop` on every component they build (3 consecutive passes required)
- Agents that are waiting for a shared component monitor `component-needed.md` for status → DONE
- When a shared component is DONE, waiting agents verify it works for their screen too

### Phase 5: Review & Ship

The orchestrator (you):
1. Read all screen decompositions and the component map
2. Verify no orphaned components, no duplicates, no conflicts
3. Optionally run a cursor CLI audit for a second opinion
4. Consult the user — present the component map (matched/close/missing across all screens)
5. Create Linear issues for each screen's implementation work
6. Update the project's large plan with the component inventory

---

## Mailbox Protocol

The mailbox is a JSONL file at `collab/figma-swarm/<project>/mailbox/messages.jsonl`.

**Message format:**
```json
{"id":"msg-001","ts":"2026-03-10T20:00:00Z","from":"agent-screen-a","to":"orchestrator","type":"status","body":"Decomposition complete. 12 components found, 3 need building.","read_by":[]}
```

**Message types:**
| Type | From | To | Purpose |
|------|------|----|---------|
| `status` | agent | orchestrator | Progress update |
| `claim` | agent | all | "I'm building ComponentX" |
| `conflict` | agent | agent(s) | "I also need ComponentX, my spec differs" |
| `consensus` | agent | agent(s) | "I agree with this spec" (counts toward 2-loop) |
| `review` | orchestrator | agent | "Reconsider this mapping" |
| `done` | agent | orchestrator | "My screen is fully mapped/built" |

**Reading messages:**
```bash
# Find unread messages for me
grep -v '"read_by".*"my-agent-name"' messages.jsonl | grep '"to":"my-agent-name"\|"to":"all"'
```

**Marking as read:**
After processing a message, append your agent name to `read_by`. Use Edit tool or a small script to update the JSON line.

---

## Component Registry (`component-needed.md`)

Shared file all agents read and write to track component status.

```markdown
# Component Registry — <project>

| Component | Needed By | Claimed By | Status | Figma Node | Specs | Local Path |
|-----------|-----------|------------|--------|------------|-------|------------|
| StatusBadge | screen-a, screen-c | agent-a | BUILDING | 540:9301 | 24x24, green/yellow/red | — |
| BottomDrawer | screen-b, screen-d | — | UNCLAIMED | 687:6107 | full-width, 60% height | — |
| PriceSlider | screen-c | agent-c | DONE | 540:9559 | reuse from onboarding | components/PriceSlider.tsx |
```

**Statuses:** `UNCLAIMED` → `CLAIMED` → `CONSENSUS` → `BUILDING` → `DONE`

---

## Drift Detection

Re-run the decomposition workflow on screens that were previously mapped. Compare the new Figma screenshot + extracted specs against the stored component map. Flag:
- New components in Figma (not in our map)
- Removed components (in our map but gone from Figma)
- Changed specs (dimensions, colors, spacing differ)

See [workflows/drift.md](workflows/drift.md).

---

## Tips

- **Start with the most complex screen** — it likely has the most shared components, so resolving it first unblocks others
- **Bottom sheets and drawers are shared components** — always add them to the registry, even if only one screen seems to need them. Other screens almost always end up needing them.
- **Don't over-decompose** — a label inside a card isn't a separate component unless it's reused elsewhere. Use judgment.
- **The orchestrator is the tiebreaker** — when agents can't agree on variant consolidation, the orchestrator decides (possibly after asking the user)
- **Check existing components carefully** — a "close match" that needs one prop added is much better than building from scratch
