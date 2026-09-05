# Inspection Workflow

Get element IDs, take screenshots, and view errors using brave-manager.

---

## Inspect Elements (CRITICAL)

**Always run inspect before interacting with elements!**

```bash
brave-manager inspect
```

This:
1. Numbers all interactive elements on the page
2. Draws red labels visible in screenshots
3. Returns element ID mapping

**Example output:**
```
1: button.submit-btn "Submit"
2: input#email
3: a.nav-link "Home"
4: input#password
5: button.login "Login"
```

**Important:** Element IDs change on page reload. Re-run `inspect` after:
- Navigation
- Page refresh
- Dynamic content loads
- Modal opens/closes

---

## Take Screenshot

Capture visual state with element labels:

```bash
brave-manager screenshot
```

Saves to: `screenshot.png` in current directory

**When to screenshot:**
- After `inspect` to see labeled elements
- Before interaction to verify state
- After interaction to confirm result
- When debugging unexpected behavior

---

## View Errors

Show last 5 network/console errors:

```bash
brave-manager errors
```

**Example output:**
```
[ERROR] GET https://api.example.com/users 404 Not Found
[ERROR] POST https://api.example.com/login 401 Unauthorized
[CONSOLE] TypeError: Cannot read property 'id' of undefined
```

**When to check errors:**
- BEFORE reproducing a bug (may already be logged)
- After action fails silently
- When page behaves unexpectedly
- To verify API responses

---

## Common Patterns

### Full Page Inspection

```bash
# Get element IDs
brave-manager inspect

# Visual verification
brave-manager screenshot

# Check for errors
brave-manager errors
```

### Pre-Interaction Check

```bash
# Always start with inspect
brave-manager inspect

# Screenshot to verify element positions
brave-manager screenshot

# Now safe to interact with IDs
brave-manager click 5
```

### Debugging a Bug

```bash
# FIRST: Check existing errors
brave-manager errors

# Get current page state
brave-manager inspect
brave-manager screenshot

# Now reproduce the bug
brave-manager click 3

# Check new errors
brave-manager errors

# Screenshot result
brave-manager screenshot
```

### After Dynamic Content Load

```bash
# Initial inspect
brave-manager inspect

# Click something that loads content
brave-manager click 2

# Wait for load
sleep 1

# RE-INSPECT (IDs changed!)
brave-manager inspect

# Now interact with new elements
brave-manager click 7
```

---

## Troubleshooting

**"No elements found"**
- Page may still be loading
- Wait and re-run `inspect`
- Check if page requires authentication

**Screenshot is blank/wrong**
- Tab might have switched
- Run `brave-manager tabs` to verify active tab
- Run `brave-manager switch <index>` to correct

**Errors shows stale data**
- `errors` shows last 5 only
- Page refresh clears error log
- Check immediately after issue occurs
