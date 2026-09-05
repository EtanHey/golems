# Setup Workflow

Create a tracking file for the Figma iteration session.

---

## Step 1: Create Tracking File

Create `docs.local/figma-iteration-progress.md` (or append to existing):

```markdown
# Figma Iteration Progress

## Session: YYYY-MM-DD

### Target: <Component/Screen Name>
- **Figma Node:** <nodeId>
- **Figma File:** <fileKey> (if using remote)
- **Implementation File:** <path/to/component.tsx>
- **Viewport:** <width>x<height> (e.g., 390x844 for mobile, 1440x900 for desktop)

### Checks

#### Check 1
- **Status:** PASS / FAIL
- **Findings:**
  - [ ] Issue found: <description>
- **Action:** <what was fixed>

#### Check 2
- **Status:** PASS / FAIL
- **Findings:**
  - (none)
- **Action:** (none needed)

...continue until 3 consecutive PASS...

### Result: COMPLETE / IN PROGRESS
- Consecutive passes: X/3
```

---

## Step 2: Gather Figma References

Before starting the loop, collect:

1. **Node ID** - From Figma URL (`node-id=95-72` → `95:72`)
2. **File Key** - From Figma URL (between `/design/` and `/Name`)
3. **Viewport size** - Match Figma frame dimensions
4. **Design context** - Run `get_design_context` to get exact specs

```typescript
// Save specs locally first (figma-workflow principle)
mcp__figma__get_design_context({ nodeId: "95:72" })
mcp__figma__get_screenshot({ nodeId: "95:72" })
```

Save to `docs.local/design-system/figma-raw/<component>.md` or `docs.local/<feature>/screen-<name>.md`.

---

## Step 3: Prepare Implementation

1. **Read the component file** that will be modified
2. **Start the dev server** if not already running
3. **Open the correct page** in browser/simulator
4. **Set viewport** to match Figma frame dimensions

For web:
```typescript
mcp__claude-in-chrome__resize_window({ width: 390, height: 844 })
mcp__claude-in-chrome__navigate({ url: "http://localhost:3000/page" })
```

For React Native:
```bash
# Boot simulator with matching device
xcrun simctl boot <DEVICE_UUID>
npx expo start --dev-client --ios
```

---

## Ready

You're now set up to run the [iterate workflow](iterate.md).
