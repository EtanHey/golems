# Interaction Workflow

Click, type, scroll, and interact with elements using brave-manager.

---

## Prerequisites

**ALWAYS run inspect first!**

```bash
brave-manager inspect
```

Element IDs are assigned by `inspect` and change on page reload.

---

## Click Element

Click an element by ID:

```bash
brave-manager click <id>
```

**Examples:**
```bash
brave-manager click 5      # Click button with ID 5
brave-manager click 12     # Click link with ID 12
```

**Important:** Element must be visible and clickable. If off-screen, scroll first.

---

## Type Into Element

Type text into an input field:

```bash
brave-manager type <id> "<text>"
```

**Examples:**
```bash
brave-manager type 2 "user@example.com"
brave-manager type 4 "secretPassword123"
brave-manager type 7 "Hello, world!"
```

**Note:** Quotes around text are required.

---

## Hover Over Element

Trigger hover state (for dropdowns, tooltips):

```bash
brave-manager hover <id>
```

**Example:**
```bash
brave-manager hover 3      # Hover menu trigger
brave-manager inspect      # Re-inspect to get dropdown IDs
brave-manager click 15     # Click dropdown option
```

---

## Scroll Page

Scroll in a direction:

```bash
brave-manager scroll up
brave-manager scroll down
```

Scroll to bring element into view:

```bash
brave-manager scroll <id>
```

**Examples:**
```bash
brave-manager scroll 42    # Scroll element 42 into center
brave-manager scroll down  # Scroll page down
```

---

## Press Keyboard Key

Press a keyboard key:

```bash
brave-manager press <key>
```

**Common keys:**
```bash
brave-manager press Enter
brave-manager press Escape
brave-manager press Tab
brave-manager press Backspace
brave-manager press ArrowDown
brave-manager press ArrowUp
```

---

## Drag and Drop

Drag one element onto another:

```bash
brave-manager drag <from_id> <to_id>
```

**Example:**
```bash
brave-manager drag 3 7     # Drag item 3 onto target 7
```

**Use cases:**
- Reordering list items
- Moving files/folders
- Drag-to-upload areas

---

## Common Patterns

### Fill Login Form

```bash
# Inspect to get element IDs
brave-manager inspect

# Fill email field
brave-manager type 2 "user@example.com"

# Fill password field
brave-manager type 4 "password123"

# Click submit button
brave-manager click 5

# Or press Enter
brave-manager press Enter
```

### Navigate Dropdown Menu

```bash
# Inspect initial state
brave-manager inspect

# Hover to open dropdown
brave-manager hover 3

# Re-inspect (dropdown now visible)
brave-manager inspect

# Click dropdown option
brave-manager click 15
```

### Handle Off-Screen Elements

```bash
# Inspect shows element 42 exists
brave-manager inspect

# Scroll to bring it into view
brave-manager scroll 42

# Now safe to click
brave-manager click 42
```

### Fill Complex Form

```bash
# Get all form element IDs
brave-manager inspect

# Fill fields one by one
brave-manager type 2 "John"
brave-manager type 3 "Doe"
brave-manager type 4 "john@example.com"
brave-manager type 5 "555-1234"

# Click submit
brave-manager click 10
```

### Keyboard Navigation

```bash
# Tab through form fields
brave-manager press Tab
brave-manager press Tab

# Type in focused field
brave-manager type 5 "text here"

# Submit with Enter
brave-manager press Enter
```

---

## Troubleshooting

**Click doesn't work**
- Element may be off-screen: `brave-manager scroll <id>`
- Element may be covered: check for modals/overlays
- ID may have changed: re-run `inspect`

**Type doesn't fill field**
- Field may not be focused: click it first
- Field may be readonly: check for disabled state
- Wrong element: verify ID with `inspect`

**Hover doesn't trigger dropdown**
- Some menus need click instead of hover
- Try: `brave-manager click <id>` instead
- Check for JS-based menus that need interaction

**Drag doesn't work**
- Source/target must both be visible
- Some UIs don't support HTML5 drag
- Check console errors: `brave-manager errors`
