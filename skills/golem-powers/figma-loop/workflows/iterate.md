# Iterate Workflow

The core Figma drilling loop. Runs until 3 consecutive checks pass.

---

## Overview

```
┌─────────────────────────────┐
│  Get Figma Screenshot       │
│  (design reference)         │
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│  Get Implementation         │
│  Screenshot (current state) │
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│  Compare Element by Element │
│  (systematic checklist)     │
└──────────┬──────────────────┘
           │
      ┌────▼────┐
      │ Match?  │
      └────┬────┘
     YES   │   NO
       ┌───┘   └───┐
       │            │
  ┌────▼────┐  ┌────▼──────────┐
  │ Pass++  │  │ Fix ONE thing │
  │         │  │ Reset counter │
  └────┬────┘  └────┬──────────┘
       │            │
  ┌────▼────┐       │
  │ 3 pass? │       │
  └────┬────┘       │
  YES  │   NO       │
   │   └────────────┤
   │                │
   ▼         ┌──────▼───────┐
  DONE       │ Loop back to │
             │ screenshots  │
             └──────────────┘
```

---

## Step 1: Capture Figma Screenshot

```typescript
// Option A: Local (Figma desktop open)
mcp__figma__get_screenshot({ nodeId: "<nodeId>" })

// Option B: Remote (from URL)
mcp__figma-remote__get_screenshot({
  fileKey: "<fileKey>",
  nodeId: "<nodeId>"
})
```

**Save as reference** - you'll compare against this each iteration.

---

## Step 2: Capture Implementation Screenshot

### Web (Claude-in-Chrome)

```typescript
// Ensure correct viewport
mcp__claude-in-chrome__resize_window({ width: 390, height: 844 })

// Navigate to the page
mcp__claude-in-chrome__navigate({ url: "http://localhost:3000/your-page" })

// Take screenshot
mcp__claude-in-chrome__computer({ action: "screenshot" })
```

### React Native (Simulator)

```bash
# Take simulator screenshot
xcrun simctl io booted screenshot /tmp/figma-check.png
```

Then read the screenshot:
```
Read /tmp/figma-check.png
```

---

## Step 3: Systematic Comparison

Go through EVERY element visible in the Figma design. For each element, check:

### Checklist Template

```markdown
### Element: <name>
- [ ] **Position**: Correct relative to parent/siblings
- [ ] **Size**: Width and height match
- [ ] **Color**: Background, text, border colors match
- [ ] **Typography**: Font size, weight, line height match
- [ ] **Spacing**: Padding and margins match
- [ ] **Border**: Radius, width, color match
- [ ] **Order**: Correct position in RTL layout
- [ ] **Icon**: Correct icon, size, color (if applicable)
```

### Comparison Strategy

1. **Start top-left** (or top-right for RTL), work systematically
2. **Check structure first** - Are all elements present?
3. **Then details** - Colors, sizes, spacing
4. **Finally states** - Hover, pressed, disabled

---

## Step 4: Decision Point

### If ALL elements match → PASS

Increment consecutive pass counter.

```markdown
#### Check N: PASS
- Consecutive passes: X/3
- No changes needed
```

If this is the **3rd consecutive pass** → **DONE**. Update tracking file:

```markdown
### Result: COMPLETE
- Total checks: N
- Consecutive passes: 3/3
- Component verified pixel-perfect against Figma
```

### If ANY element doesn't match → FAIL

**Fix exactly ONE discrepancy.** The most visually impactful one.

```markdown
#### Check N: FAIL
- **Issue:** <what's wrong>
- **Fix:** <what code change was made>
- Consecutive passes reset to: 0/3
```

**Why only one fix?** Multiple fixes can interact. Fixing spacing might affect alignment. One fix at a time ensures each change is verified.

---

## Step 5: After Fix → Loop Back

After making the ONE fix:

1. **Wait for hot reload** (or rebuild if needed)
2. **Go back to Step 2** - take a new implementation screenshot
3. **Compare again** from Step 3

---

## Example Session

```markdown
## Component: Welcome Screen Header

### Check 1
- Logo position: slightly too high (top-[8%] should be top-[10%])
- **Status: FAIL** → Fixed logo top position
- Passes: 0/3

### Check 2
- Title font size: text-2xl should be text-3xl
- **Status: FAIL** → Fixed title font size
- Passes: 0/3

### Check 3
- All elements match
- **Status: PASS**
- Passes: 1/3

### Check 4
- All elements match
- **Status: PASS**
- Passes: 2/3

### Check 5
- Noticed subtitle color slightly off (#6B7280 vs #868D9C)
- **Status: FAIL** → Fixed subtitle color
- Passes: 0/3

### Check 6
- All elements match
- **Status: PASS**
- Passes: 1/3

### Check 7
- All elements match
- **Status: PASS**
- Passes: 2/3

### Check 8
- All elements match
- **Status: PASS**
- Passes: 3/3

### Result: COMPLETE (8 checks, 3 consecutive passes)
```

---

## Tips

- **Don't rush** - Take time comparing each element
- **Use design context** for exact values, not eyeballing
- **Check both viewports** if component is responsive (mobile + desktop)
- **RTL matters** - Element order in DOM vs visual position
- **Zoom in** on screenshots for subtle differences
- **Use exact hex colors** from Figma, never approximate
