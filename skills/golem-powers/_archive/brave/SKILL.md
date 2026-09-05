---
name: brave
status: experimental
description: "Use as fallback browser automation when Claude-in-Chrome MCP is unavailable. Covers browser control, navigation, screenshots, clicking, typing. NOT for: headless testing (use Playwright). Claude Code users should prefer MCP first."
---

# Brave Browser Management (v2.2.0)

> Browser automation via brave-manager CLI. **Claude Code should prefer Claude-in-Chrome MCP** - use brave-manager as fallback.

## Prerequisites Check

**1. Check brave-manager installed:**
```bash
which brave-manager || echo "Not installed"
```

**2. Launch Brave with debug port enabled:**
```bash
# Close Brave completely first, then:
open -a 'Brave Browser' --args --remote-debugging-port=9222
```

If Brave is already running without the debug flag, quit it completely and relaunch.

**3. Verify connection:**
```bash
brave-manager tabs
```

If not installed or connection issues: See [workflows/debugging.md](workflows/debugging.md)

---

## Quick Actions

| What you want to do | Workflow |
|---------------------|----------|
| Navigate, switch tabs, page history | [workflows/navigation.md](workflows/navigation.md) |
| Get element IDs, take screenshots, see errors | [workflows/inspection.md](workflows/inspection.md) |
| Click, type, scroll, drag elements | [workflows/interaction.md](workflows/interaction.md) |
| Run JS eval, verify state, debug | [workflows/debugging.md](workflows/debugging.md) |

---

## Core Concept: ID-Based Interaction

**Always inspect first!** Before clicking or typing:

```bash
brave-manager inspect
```

This:
1. Numbers all interactive elements on the page
2. Draws red labels for visual reference
3. Returns the ID mapping for use with click/type/hover

---

## Decision Tree

**Need to navigate?**
- Open URL, switch tabs, go back/forward
- Use: [workflows/navigation.md](workflows/navigation.md)

**Need to see the page state?**
- Inspect elements, take screenshots, check errors
- Use: [workflows/inspection.md](workflows/inspection.md)

**Need to interact with elements?**
- Click buttons, fill forms, scroll, drag
- Use: [workflows/interaction.md](workflows/interaction.md)

**Need to verify/debug?**
- Run JavaScript, check localStorage, debug state
- Use: [workflows/debugging.md](workflows/debugging.md)

---

## Command Quick Reference

| Command | Purpose |
|---------|---------|
| `tabs` | List all open tabs |
| `switch <index>` | Focus specific tab |
| `navigate <url>` | Go to URL |
| `back` / `forward` | Browser history |
| `inspect` | Get element IDs (REQUIRED before interaction) |
| `screenshot` | Save visual state |
| `errors` | Last 5 network/console errors |
| `click <id>` | Click element |
| `type <id> "text"` | Type into element |
| `hover <id>` | Hover element |
| `scroll <up\|down\|id>` | Scroll page or to element |
| `press <key>` | Press keyboard key |
| `drag <from> <to>` | Drag between elements |
| `eval "code"` | Run JavaScript |

---

## Safety Rules

1. **Always inspect first** - Element IDs change between page loads
2. **Check errors** - Use `errors` before reproducing bugs
3. **Screenshot often** - Visual verification prevents assumptions
4. **Scroll before click** - Off-screen elements may not be clickable
