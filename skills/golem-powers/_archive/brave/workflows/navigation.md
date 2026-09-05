# Navigation Workflow

Manage tabs, navigate pages, and browser history using brave-manager.

---

## List Open Tabs

View all tabs and their URLs:

```bash
brave-manager tabs
```

Returns indexed list:
```
0: https://example.com/page1
1: https://github.com/user/repo
2: https://localhost:3000
```

---

## Switch Tabs

Focus a specific tab by index:

```bash
brave-manager switch <index>
```

**Example:**
```bash
brave-manager switch 2
```

Verify: Tab at index 2 is now active.

---

## Navigate to URL

Go directly to a page:

```bash
brave-manager navigate <url>
```

**Examples:**
```bash
brave-manager navigate https://github.com
brave-manager navigate localhost:3000
brave-manager navigate file:///path/to/local.html
```

**Important:** Wait for page load before interacting with elements.

---

## Browser History

Navigate back:
```bash
brave-manager back
```

Navigate forward:
```bash
brave-manager forward
```

---

## Common Patterns

### Open URL and Verify

```bash
# Navigate to page
brave-manager navigate https://app.example.com/login

# Wait and verify
sleep 1
brave-manager screenshot
```

### Tab Workflow

```bash
# List tabs
brave-manager tabs

# Switch to specific tab
brave-manager switch 0

# Navigate within that tab
brave-manager navigate https://new-url.com
```

### Multi-Tab Verification

```bash
# Check all tabs
brave-manager tabs

# Switch to app tab
brave-manager switch 1

# Take screenshot of current state
brave-manager screenshot
```

---

## Troubleshooting

**"No browser tabs found"**
- Brave browser may not be running
- Ensure brave-manager daemon is started

**Navigation doesn't work**
- Check URL format (include https:// for external sites)
- For local dev, use `localhost:PORT` or `127.0.0.1:PORT`

**Tab switch doesn't take effect**
- Verify index from `tabs` output (0-indexed)
- Run `tabs` again to confirm current state
