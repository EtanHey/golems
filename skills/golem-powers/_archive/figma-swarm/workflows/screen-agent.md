# Screen Agent — Decompose + Map One Screen

> You are a screen agent in a figma-swarm. Your job: decompose your assigned Figma screen into components, map them to the local library, and coordinate shared components with other agents.

## Your Environment

You were given:
- `screen-name` — your screen identifier
- `figma-file-key` — the Figma file to query
- `figma-node-id` — your screen's node ID
- `component-inventory` — path to the existing component list
- `collab-folder` — `collab/figma-swarm/<project>/`
- `agent-name` — your identifier (e.g., `agent-personal-details`)

## Step 1: Screenshot

Get your screen from Figma:
```
mcp__figma__get_screenshot(nodeId: "<your-node-id>")
# OR
mcp__figma-remote__get_screenshot(fileKey: "<file-key>", nodeId: "<your-node-id>")
```

Study the screenshot carefully. Identify every distinct UI element.

## Step 2: Extract Components

For each visible component, document:

| Property | What to capture |
|----------|----------------|
| **Name** | Descriptive name (e.g., `EmailInputField`, `SaveButton`) |
| **Type** | button, input, card, label, icon, drawer, sheet, list-item, etc. |
| **Dimensions** | Width x Height in px |
| **Position** | Offset from parent container (x, y) |
| **Spacing** | Padding (inner), margin (outer), gap (between siblings) |
| **Colors** | Background, text, border, shadow |
| **Typography** | Font family, size, weight, line height |
| **Border** | Radius, width, color |
| **States** | Default, hover, active, disabled, focused (if visible) |
| **Content** | Label text, placeholder text, icon name |

## Step 3: Map to Local Components

Read the component inventory. For each extracted component:

**Matched** — Exact local equivalent exists:
```
StatusBadge → components/StatusBadge.tsx ✅
  Props needed: status="active", size="sm"
```

**Close match** — Similar component exists but needs modification:
```
PriceInput → components/PriceSlider.tsx ⚠️ CLOSE
  Difference: needs histogram overlay, current only has slider
  Action: flag for variant consolidation review
```

**Missing** — No local equivalent:
```
DateOfBirthPicker → ❌ MISSING
  Specs: 390x154, 3 scroll wheels (day/month/year), grey-100 bg
  Figma node: 678:5541
  Action: add to component-needed.md
```

## Step 4: Register Missing Components

For each MISSING component, add a row to `component-needed.md`:

```markdown
| DateOfBirthPicker | agent-personal-details | — | UNCLAIMED | 678:5541 | 390x154, scroll wheels | — |
```

**Check first**: read `component-needed.md` before adding. Another agent may have already registered the same component. If so, add your agent name to the "Needed By" column instead.

## Step 5: Write Decomposition

Save your full decomposition to `collab/figma-swarm/<project>/screens/<screen-name>.md`:

```markdown
# Screen: <Screen Name>

**Figma node:** <node-id>
**Agent:** <agent-name>
**Date:** <date>
**Total components:** N (M matched, K close-match, J missing)

## Component Map

| # | Component | Type | Local Match | Status | Specs |
|---|-----------|------|-------------|--------|-------|
| 1 | BackButton | button | components/IconButton.tsx | ✅ Matched | 44x44, icon=chevron-left |
| 2 | PageTitle | label | — (inline text) | ✅ Skip | H2, "Personal Details" |
| 3 | AvatarUpload | button | ❌ Missing | REGISTERED | 80x80 circle, camera icon overlay |
| ...

## Layout

- Vertical scroll, 16px horizontal padding
- 24px gap between sections
- Bottom safe area: 34px (iPhone notch)

## Notes

- <any observations about patterns, shared components, or edge cases>
```

## Step 6: Notify Orchestrator

Append to `mailbox/messages.jsonl`:
```json
{"id":"msg-<unique>","ts":"<iso-timestamp>","from":"<agent-name>","to":"orchestrator","type":"status","body":"Decomposition complete. N components: M matched, K close, J missing.","read_by":[]}
```

## Step 7: Consensus (if you have shared components)

Follow the [consensus workflow](consensus.md):
1. Monitor `component-needed.md` for claims on components you need
2. If someone claims a component you need → read their spec → agree or propose changes
3. 2 straight consensus loops required before building proceeds
4. If you and another agent have similar components → flag for variant consolidation

## Step 8: Build & Verify

For components you own (CLAIMED by you, CONSENSUS achieved if shared):
1. Build the component
2. Run `/figma-loop` — 3 consecutive passes required
3. Update `component-needed.md`: status → DONE, add local path
4. Notify orchestrator via mailbox

## Step 9: Done

When all your screen's components are either matched or built:
```json
{"id":"msg-<unique>","ts":"<iso-timestamp>","from":"<agent-name>","to":"orchestrator","type":"done","body":"Screen <name> fully mapped and verified. All components matched or built.","read_by":[]}
```
