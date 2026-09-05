# Setup — Create Collab Folder for a Project

## Step 1: Create Directory Structure

```bash
PROJECT="<project-name>"  # e.g., "profile", "onboarding", "listings"

mkdir -p "collab/figma-swarm/$PROJECT/"{mailbox,screens}
touch "collab/figma-swarm/$PROJECT/mailbox/messages.jsonl"
```

## Step 2: Create Component Registry

Write `collab/figma-swarm/$PROJECT/component-needed.md`:

```markdown
# Component Registry — $PROJECT

> Shared registry for all screen agents. Read before adding. Claim before building.
> See /figma-swarm consensus workflow for the 2-consensus-loop protocol.

| Component | Needed By | Claimed By | Status | Figma Node | Specs | Local Path |
|-----------|-----------|------------|--------|------------|-------|------------|
```

## Step 3: Gather Inputs

Before spawning agents, collect:

1. **Figma file key** — from the Figma URL: `figma.com/design/<FILE_KEY>/...`
2. **Screen node IDs** — each screen's node ID from Figma (format: `540:9301`)
3. **Component inventory** — path to existing component docs (e.g., `docs.local/design-system/ui-native-inventory.md`)
4. **Reuse map** (if exists) — known component reuse patterns (e.g., `REUSE-MAP.md`)
5. **Design tokens** (if exists) — colors, typography, spacing values

## Step 4: Verify Figma MCP

Confirm at least one Figma MCP tool is available:
```
mcp__figma__get_screenshot        # Local (Figma desktop open)
mcp__figma-remote__get_screenshot # Remote (API, always available)
```

Test with one screen node to confirm access.
