# Single Check Workflow

Run one comparison check without the full iteration loop. Useful for spot-checking or verifying after a set of changes.

---

## Step 1: Get Both Screenshots

Take Figma and implementation screenshots simultaneously:

```typescript
// Figma reference
mcp__figma__get_screenshot({ nodeId: "<nodeId>" })

// Implementation state
mcp__claude-in-chrome__computer({ action: "screenshot" })
// OR for React Native:
// xcrun simctl io booted screenshot /tmp/check.png
```

---

## Step 2: Compare Systematically

For each visible element, verify:

| Check | Status |
|-------|--------|
| All elements present | |
| Correct order (RTL: first=RIGHT, last=LEFT) | |
| Positions match | |
| Sizes match | |
| Colors match (exact hex) | |
| Typography matches (size, weight) | |
| Spacing matches (gaps, padding) | |
| Border radius matches | |
| Icons correct (type, size, color, position) | |
| Next/action buttons on LEFT (RTL) | |
| Progress indicators move RIGHT-to-LEFT (RTL) | |

---

## Step 3: Report

### If everything matches:
```
CHECK PASSED - All elements match Figma design.
```

### If discrepancies found:
```
CHECK FAILED - Found N discrepancies:
1. <element>: <expected> vs <actual>
2. <element>: <expected> vs <actual>
...
```

---

## RTL-Specific Checks

**These are commonly missed and cause subtle bugs:**

| Element | RTL Behavior | Check |
|---------|-------------|-------|
| "Next" / "Continue" button | LEFT side of screen | Position |
| "Back" button | RIGHT side of screen | Position |
| Progress bar | Fills from RIGHT to LEFT | Direction |
| Step indicators | Start from RIGHT | Order |
| Chevron icons | Point LEFT for "forward" | Direction |
| Text alignment | Right-aligned by default | Alignment |
| Form labels | Right-aligned, above input | Position |
| Error messages | Right-aligned | Position |
| Toast/snackbar | Action button on LEFT | Layout |

---

## When to Use

- Quick visual sanity check before committing
- Verifying a specific section without full loop
- Checking responsive behavior at different breakpoints
- Validating after a code review requested changes
