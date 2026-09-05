---
name: figma-loop
description: "Figma-to-code pixel verification loop. Triggers: Figma designs, pixel perfect, design verification."
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.css"
  - "**/*.scss"
---

# Figma Loop - Iterative Design Verification

> Drill on Figma designs until pixel-perfect. Compare screenshots, fix one thing at a time, repeat until 3 consecutive checks pass with no changes needed.

## When to Use

- Implementing UI from Figma designs
- Refining existing UI to match Figma
- Verifying a component matches its design spec
- User says "make it match Figma" or "pixel-perfect"

## Prerequisites

**At least one of these Figma MCP tools must be available:**

| Tool | When Available |
|------|---------------|
| `mcp__figma__get_screenshot` | Figma desktop app is open |
| `mcp__figma-remote__get_screenshot` | Always (uses API with fileKey) |

**Plus browser automation for implementation screenshots:**

| Tool | Purpose |
|------|---------|
| `mcp__claude-in-chrome__computer` | Screenshot of running app |
| `mcp__claude-in-chrome__navigate` | Navigate to the right page |
| `mcp__claude-in-chrome__resize_window` | Match Figma viewport size |

**Or for React Native:**

| Tool | Purpose |
|------|---------|
| Simulator screenshot | `xcrun simctl io booted screenshot /tmp/screen.png` |
| Device build | `npx expo run:ios --device` |

---

## CLI Helper

Track iteration progress with `check.sh`:

```bash
SCRIPT="$HOME/.claude/skills/figma-loop/scripts/check.sh"

$SCRIPT init "WelcomeScreen" "95:72"   # Start session
$SCRIPT pass                            # Record passing check (increments counter)
$SCRIPT fail "spacing off by 8px"       # Record fail (resets counter to 0)
$SCRIPT status                          # Show progress (X/3 passes)
```

---

## Quick Actions

| What you want to do | Workflow |
|---------------------|----------|
| Full iteration loop (start to finish) | [workflows/iterate.md](workflows/iterate.md) |
| Set up tracking file | [workflows/setup.md](workflows/setup.md) |
| Just do a single comparison check | [workflows/check.md](workflows/check.md) |

---

## The 3-Check Rule

A component is only "done" when **3 consecutive checks pass with zero changes needed**.

```
Check 1: Fix spacing  → FAIL (made change) → counter resets to 0
Check 2: Fix color    → FAIL (made change) → counter resets to 0
Check 3: All good     → PASS → counter = 1
Check 4: All good     → PASS → counter = 2
Check 5: All good     → PASS → counter = 3 → DONE
```

**Why 3?** One pass could be lucky. Two could miss something. Three consecutive passes with fresh eyes each time gives confidence.

---

## Check Criteria

For each element, verify ALL of these:

| Category | What to Check |
|----------|--------------|
| **Position** | Top, left, right, bottom, center alignment |
| **Size** | Width, height, padding, margin |
| **Colors** | Background, text, border, shadow |
| **Typography** | Font size, weight, line height, letter spacing |
| **Spacing** | Gaps between elements, internal padding |
| **Order** | RTL consideration (first in DOM = RIGHT visually) |
| **Icons** | Which icon, size, color, position relative to text |
| **States** | Default, hover, pressed, disabled, focused |
| **Radius** | Border radius on all corners |

---

## Common Figma-to-Tailwind Mappings

```
gap-[16px] → gap-4
p-[8px]    → p-2
p-[12px]   → p-3
p-[16px]   → p-4
p-[24px]   → p-6

rounded-[8px]  → rounded-lg
rounded-[12px] → rounded-xl
rounded-[16px] → rounded-2xl
rounded-[24px] → rounded-3xl

text-[14px] → text-sm
text-[16px] → text-base
text-[18px] → text-lg
text-[20px] → text-xl
text-[24px] → text-2xl
text-[28px] → text-3xl
```

---

## RTL Quick Reference for Figma

| Visual Position (RTL) | DOM Order | Tailwind |
|----------------------|-----------|----------|
| RIGHT | First | `items-start`, `justify-start` |
| LEFT | Last | `items-end`, `justify-end` |

**Button icons in RTL:**
```tsx
// Icon on LEFT visually (after text in RTL)
<Button rightIcon={<Phone />}>Call</Button>

// Icon on RIGHT visually (before text in RTL)
<Button leftIcon={<Phone />}>Call</Button>
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Fix 5 things at once | Fix ONE thing, re-screenshot, verify |
| Skip checks when "it looks close" | Always do formal screenshot comparison |
| Hardcode pixel values | Use Tailwind scale or CSS vars |
| Ignore RTL | Verify element order matches RTL expectations |
| Guess colors | Use exact hex from Figma design context |
| Stop after 1 passing check | Need 3 CONSECUTIVE passes |
