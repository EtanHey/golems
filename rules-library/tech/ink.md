# Ink (React CLI) Context

**When this loads:** Projects with `ink` in dependencies

---

## CRITICAL: Keyboard Input Setup

Ink's `useInput` hook may not receive keyboard input even when `isRawModeSupported` returns true.

### Required Setup BEFORE `render()`

```typescript
import { render } from 'ink';

// MUST do this BEFORE render():
if (process.stdin.isTTY && process.stdin.setRawMode) {
  process.stdin.setRawMode(true);
  process.stdin.resume();  // BOTH are required!
}

// Pass stdin/stdout explicitly:
const instance = render(<App />, {
  exitOnCtrlC: false,  // Handle Ctrl+C via SIGINT instead
  stdin: process.stdin,
  stdout: process.stdout,
});
```

### Why This Matters
- Without `setRawMode(true)` + `resume()`, `useInput()` receives nothing
- Terminal responds to direct Node stdin test but Ink doesn't work
- This is NOT a terminal issue - it's Ink initialization

---

## Ctrl+C Handling

**DO NOT** use process-level stdin handlers alongside Ink:

```typescript
// BAD - conflicts with Ink's useInput:
process.stdin.on('data', (d) => { if (d[0] === 0x03) exit(); });

// GOOD - SIGINT handles Ctrl+C at signal level:
process.on('SIGINT', () => cleanupAndExit());
```

---

## Multi-Component Keyboard Handling

Use `isActive` prop when multiple components need keyboard input:

```typescript
// Main view - disabled when modal open
useInput((input, key) => { ... }, { isActive: !modalOpen });

// Modal - active when rendered
useInput((input, key) => { ... }, { isActive: true });
```

---

## Terminal Cleanup on Exit

Always reset raw mode before exiting:

```typescript
function cleanupAndExit(code = 0) {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);  // Reset terminal state
  }
  process.exit(code);
}
```

---

## Debugging Keyboard Issues

Quick test to verify terminal stdin works (independent of Ink):

```bash
node -e "process.stdin.setRawMode(true); process.stdin.on('data', d => { console.log('Got:', d[0]); if(d[0]===113) process.exit(); }); console.log('Press q to quit');"
```

If this works but Ink doesn't, the issue is Ink setup.

---

## Reference Implementation

See `ralph-ui/src/index.tsx`:
- Lines 378-395: Runner mode stdin setup
- Lines 498-523: Display mode stdin setup
- Line ~55: SIGINT handler

See `ralph-ui/src/components/Dashboard.tsx`:
- Lines 38-96: Keyboard handler components with `isActive` pattern
