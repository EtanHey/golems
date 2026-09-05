# Accessibility Audit Workflow

Check code for accessibility issues (a11y).

## Quick Start

Run the accessibility script directly:

```bash
./scripts/accessibility.sh
```

This outputs a Markdown report with a11y findings and checklist.

## When to Use

- UI component changes
- Form implementations
- New pages/views
- Before releasing user-facing features

## Steps

### Step 1: Run a11y audit

**Using the script (recommended):**
```bash
./scripts/accessibility.sh
```

**Manual alternative:**
```bash
cr review --prompt-only | grep -iE "accessibility|a11y|aria|alt|label|focus|keyboard|screen.?reader|contrast|role"
```

### Step 2: Accessibility checklist

| Check | What to Look For |
|-------|------------------|
| Images | Missing `alt` attributes |
| Forms | Missing `label` elements or `aria-label` |
| Buttons | Icon-only buttons without `aria-label` |
| Focus | Interactive elements not focusable |
| Keyboard | Can't navigate with Tab/Enter/Escape |
| Contrast | Low color contrast ratios |
| Roles | Missing ARIA roles on custom components |
| Headings | Skipped heading levels (h1 → h3) |

### Step 3: Common issues

```
[MEDIUM] img element missing alt attribute - src/components/Avatar.tsx:12
[MEDIUM] Button has no accessible name - src/components/IconButton.tsx:8
[LOW] Consider adding aria-describedby for form validation - src/forms/Login.tsx:45
[LOW] Focus indicator may be hard to see - src/styles/global.css:23
```

### Step 4: Quick fixes

```tsx
// Bad
<img src={avatar} />
<button><Icon /></button>

// Good
<img src={avatar} alt="User avatar" />
<button aria-label="Close dialog"><Icon /></button>
```

## RTL Considerations

For Hebrew/Arabic UIs:
- Check `dir="rtl"` propagation
- Verify flex direction reversal
- Ensure text alignment is correct

## Related Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/review.sh` | Full code review |
| `./scripts/pr-ready.sh` | Comprehensive PR check |
