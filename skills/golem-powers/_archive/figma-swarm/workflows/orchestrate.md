# Orchestrate — Full Pipeline

> The orchestrator's playbook. You run this workflow; screen agents run `screen-agent.md`.

## Inputs

- **Figma file key** (e.g., `ZTrCM0RDRJQT4m2xGzKEBR`)
- **Screen node IDs** — list of Figma node IDs to decompose
- **Component inventory path** — where to find existing built components
- **Project name** — used for the collab folder

## Step 1: Setup

```bash
# Create collab structure
mkdir -p collab/figma-swarm/<project>/{mailbox,screens}
```

Seed `component-needed.md`:
```markdown
# Component Registry — <project>

| Component | Needed By | Claimed By | Status | Figma Node | Specs | Local Path |
|-----------|-----------|------------|--------|------------|-------|------------|
```

Seed `mailbox/messages.jsonl` as empty file.

## Step 2: Spawn Screen Agents

Use `/cmux-agents` to spawn one agent per screen. Each agent gets:

```
You are a screen agent for the figma-swarm pipeline.

Your screen: <screen-name>
Figma file key: <file-key>
Figma node ID: <node-id>
Component inventory: <path-to-inventory>
Collab folder: collab/figma-swarm/<project>/
Your agent name: agent-<screen-name>

Follow the /figma-swarm screen-agent workflow:
1. Screenshot your screen via Figma MCP
2. Extract every component with specs (dimensions, position, colors, typography)
3. Map each to the component inventory — matched, close-match, or missing
4. Write missing components to component-needed.md
5. Write your full decomposition to screens/<screen-name>.md
6. Send a status message to the mailbox when done
7. Watch for shared component claims — participate in consensus if you need a component someone else claimed
8. After consensus, build your claimed components and /figma-loop verify them
9. When everything for your screen is mapped + verified, send a done message
```

## Step 3: Monitor

While agents work:
1. Poll `mailbox/messages.jsonl` for status updates (use /loop every 2-3 min)
2. Watch `component-needed.md` for conflicts
3. If variant consolidation is flagged → make the call (one component with variants vs. separate)
4. If agents are stuck in consensus → intervene with a `review` message

## Step 4: Review

When all agents report `done`:
1. Read every `screens/<screen>.md` decomposition
2. Read the final `component-needed.md` — all should be DONE
3. Cross-reference: does every screen's component list match the registry?
4. Optionally: run a cursor CLI audit on the component mapping
5. Build `component-map.md` — the single source of truth

## Step 5: Ship

1. Present the **component map** to the user — the full inventory of matched/close/missing components across all screens, with specs and build status
2. After user approval, create Linear issues:
   - One issue per screen (implementation task)
   - One issue per shared component (if not already built)
   - Link screen issues to their component dependencies
3. Update the project's large plan with the new inventory
4. Store the mapping in BrainLayer for future drift detection
