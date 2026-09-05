# Debugging Workflow

Run JavaScript, verify state, and debug browser issues using brave-manager.

---

## Eval Command

Execute JavaScript in the page context:

```bash
brave-manager eval "<code>"
```

**Important:** Quotes around code are required.

---

## Check LocalStorage

```bash
brave-manager eval "JSON.stringify(localStorage)"
```

**Get specific key:**
```bash
brave-manager eval "localStorage.getItem('authToken')"
```

---

## Check SessionStorage

```bash
brave-manager eval "JSON.stringify(sessionStorage)"
```

**Get specific key:**
```bash
brave-manager eval "sessionStorage.getItem('userId')"
```

---

## Check Cookies

```bash
brave-manager eval "document.cookie"
```

**Check for specific cookie:**
```bash
brave-manager eval "document.cookie.includes('session_id')"
```

---

## Check Page Variables

```bash
brave-manager eval "window.appState"
brave-manager eval "window.__INITIAL_DATA__"
brave-manager eval "window.React"
```

---

## Check DOM State

**Element exists:**
```bash
brave-manager eval "document.querySelector('#submit-btn') !== null"
```

**Element visible:**
```bash
brave-manager eval "document.querySelector('#modal').style.display !== 'none'"
```

**Element text:**
```bash
brave-manager eval "document.querySelector('.error-message')?.textContent"
```

**Input value:**
```bash
brave-manager eval "document.querySelector('input#email').value"
```

---

## Common Patterns

### Verify Login State

```bash
# Check auth token
brave-manager eval "localStorage.getItem('token') !== null"

# Check user object
brave-manager eval "JSON.stringify(JSON.parse(localStorage.getItem('user')))"
```

### Verify Form Submission

```bash
# Fill form
brave-manager type 2 "user@example.com"
brave-manager click 5

# Check if success message appears
brave-manager eval "document.querySelector('.success-message')?.textContent"

# Check localStorage for saved data
brave-manager eval "localStorage.getItem('lastSubmission')"
```

### Debug API State

```bash
# Check for pending requests
brave-manager eval "window.pendingRequests || 'none'"

# Check cached data
brave-manager eval "JSON.stringify(window.cache || {})"

# Check error state
brave-manager eval "window.lastError"
```

### Verify React/Vue State

**React:**
```bash
brave-manager eval "document.querySelector('[data-reactroot]') !== null"
```

**Vue:**
```bash
brave-manager eval "window.__VUE__ !== undefined"
```

### Check Network Errors (Combined)

```bash
# Check errors from brave-manager
brave-manager errors

# Check JavaScript error state
brave-manager eval "window.lastError || 'no error'"

# Check for error elements
brave-manager eval "document.querySelector('.error')?.textContent"
```

---

## Advanced Verification

### Wait for Element

```bash
# Retry pattern - check until element exists
brave-manager eval "document.querySelector('.loaded-content') !== null"
# If false, wait and try again
sleep 1
brave-manager eval "document.querySelector('.loaded-content') !== null"
```

### Deep State Inspection

```bash
# Get all localStorage keys
brave-manager eval "Object.keys(localStorage)"

# Get all sessionStorage keys
brave-manager eval "Object.keys(sessionStorage)"

# Count items in storage
brave-manager eval "localStorage.length"
```

### Verify Redirects

```bash
# Check current URL
brave-manager eval "window.location.href"

# Check if on expected page
brave-manager eval "window.location.pathname === '/dashboard'"
```

---

## Troubleshooting

**"brave-manager not found"**
- Install brave-manager if missing
- Check PATH includes brave-manager location
- Verify with: `which brave-manager`

**"No tabs found" or "Cannot connect to browser"**
Brave must be launched with remote debugging enabled:

```bash
# Close Brave completely first, then:
open -a 'Brave Browser' --args --remote-debugging-port=9222
```

Or from terminal:
```bash
'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' --remote-debugging-port=9222
```

**Important:** If Brave is already running without the debug flag, you must quit it completely and relaunch with the flag.

**Eval returns undefined**
- Variable may not exist on page
- Check spelling and case
- Use optional chaining: `obj?.prop`

**Eval execution error**
- Check JavaScript syntax
- Ensure proper quote escaping
- Try simpler expressions first

**State doesn't match UI**
- UI may not reflect latest state
- Refresh and check again
- Some apps use virtual DOM

**"Cannot access storage"**
- Page may block storage access
- Check browser security settings
- Some iframes restrict storage
