# Fast Batch Submission Workflow

> **Goal:** Submit N research prompts to a claude.ai project in 2-5 minutes instead of 40 minutes.
>
> **How:** Collapse the per-prompt loop into a single `javascript_tool` call that handles click → Research → paste → send → verify → navigate back — all in one round-trip.

## Why This Is Faster

The manual flow uses 6-8 Chrome MCP round-trips per prompt:
1. `screenshot` (see state)
2. `left_click` (click "+")
3. `screenshot` (verify menu)
4. `left_click` (click "Research")
5. `javascript_tool` (paste prompt)
6. `find` + `left_click` (send)
7. `wait` + `screenshot` (verify research started)
8. `left_click` (navigate back)

Each round-trip takes 3-5 seconds. 8 calls × 10 prompts = 80 calls × ~4s = **~5 minutes of pure network overhead** plus thinking time = **~40 minutes total**.

The fast path: **2 calls per prompt** (one JS call to do everything, one to confirm MCP modal if it appears). 2 calls × 10 prompts = 20 calls = **~2-3 minutes total**.

## Architecture: Hybrid Approach

Use Chrome MCP `javascript_tool` for the click-paste-send-navigate loop. Use Chrome MCP `computer` actions only for the MCP connector modal (which overlays the page and may need pixel-level interaction).

### Why Not Pure JS?

The MCP connector modal ("Enable connectors for Claude to use in research") is a React portal/overlay. Its buttons may not be easily addressable via `document.querySelector` because:
- It renders in a portal outside the main DOM tree
- Button text ("Confirm") may be inside nested spans
- The modal appears asynchronously after Research is enabled

**Solution:** The JS function handles everything up to and including the send. Then we take a screenshot to check if the MCP modal appeared, and if so, click "Confirm" via Chrome MCP `computer` action.

## The Fast-Path Function

### Step 1: Read All Prompt Files

Before starting the loop, read all prompt files into memory:

```
promptFiles = list all .md files in the batch directory
prompts = []
for each file:
  content = Read(file)
  prompts.push({ filename: file.name, content: content })
```

### Step 2: Navigate to Project

```
navigate(projectUrl)
wait for page to load
verify project page (look for "How can I help you today?" input)
```

### Step 3: Per-Prompt Fast Loop

For each prompt, execute this **single** `javascript_tool` call:

```javascript
// === FAST-PATH: Single JS call per prompt ===
// This function clicks +, clicks Research, pastes the prompt, and clicks Send
// all within one javascript_tool execution (~200ms total DOM manipulation)

(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // --- 1. Click the "+" button to open the menu ---
  const plusBtn = document.querySelector('button[aria-label="Add files, connectors, and more"]')
    || document.querySelector('fieldset button:first-child')
    || [...document.querySelectorAll('button')].find(b =>
      b.querySelector('svg') && b.closest('[class*="input"]'));
  if (!plusBtn) throw new Error('Could not find + button');
  plusBtn.click();
  await sleep(500); // wait for dropdown animation

  // --- 2. Click "Research" in the dropdown menu ---
  // Research has a magnifying glass icon, is a top-level menu item
  // NOT "Web search" (which has a globe icon and green checkmark)
  const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], button');
  let researchBtn = null;
  for (const item of menuItems) {
    const text = item.textContent?.trim();
    // Match "Research" exactly — NOT "Web search"
    if (text === 'Research') {
      researchBtn = item;
      break;
    }
  }
  if (!researchBtn) {
    // Fallback: find by partial text match, excluding "Web search"
    for (const item of menuItems) {
      const text = item.textContent?.trim();
      if (text?.includes('Research') && !text?.includes('Web')) {
        researchBtn = item;
        break;
      }
    }
  }
  if (!researchBtn) throw new Error('Could not find Research menu item');
  researchBtn.click();
  await sleep(800); // wait for Research to activate + menu to close

  // --- 3. Check if we're still on the project page ---
  // After clicking Research, the blue magnifying glass should appear
  // If the menu closed, we're good. If it opened a conversation, we went wrong.
  // Give it a moment to settle.
  await sleep(300);

  // --- 4. Paste the prompt via execCommand ---
  const PROMPT_TEXT = `__PROMPT_PLACEHOLDER__`;
  const el = document.querySelector('[contenteditable="true"]');
  if (!el) throw new Error('Could not find contenteditable input');
  el.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, PROMPT_TEXT);
  await sleep(300); // let React state update

  // --- 5. Click Send ---
  const sendBtn = document.querySelector('button[aria-label="Send message"]')
    || [...document.querySelectorAll('button')].find(b =>
      b.getAttribute('aria-label')?.includes('Send'));
  if (!sendBtn) throw new Error('Could not find Send button');
  sendBtn.click();

  return 'SENT';
})();
```

### Step 4: Handle MCP Modal

After the JS function returns 'SENT', wait 3-5 seconds then take a screenshot:

```
wait(4 seconds)
screenshot()
```

**If MCP modal is visible** ("Enable connectors for Claude to use in research"):
- Click "Confirm" button at approximately (889, 556) — or use `find("Confirm button")`
- Wait 3 seconds for research to start

**If NO modal** (research started directly):
- Verify "Creating my research plan..." text is visible
- Good to go

### Step 5: Navigate Back to Project

Use a single JS call to click the project breadcrumb:

```javascript
// Click project name in breadcrumb to return to project page
const breadcrumb = document.querySelector('a[href*="/project/"]')
  || [...document.querySelectorAll('a, button')].find(el =>
    el.textContent?.includes('Native Apps Research'));  // or whatever the project name is
if (breadcrumb) {
  breadcrumb.click();
} else {
  // Fallback: navigate directly
  window.location.href = '__PROJECT_URL__';
}
'NAVIGATED';
```

Wait 2 seconds for the project page to load.

### Step 6: Repeat

Go back to Step 3 for the next prompt.

## Optimized Call Count Per Prompt

| Step | Tool Call | Time |
|------|-----------|------|
| Click + → Research → Paste → Send | `javascript_tool` (1 call) | ~2s |
| Wait + Screenshot | `wait` + `screenshot` (1 call) | ~4s |
| Confirm MCP modal (if present) | `computer.left_click` (1 call, conditional) | ~1s |
| Wait for research to start | `wait` (1 call) | ~3s |
| Navigate back | `javascript_tool` (1 call) | ~2s |
| **Total per prompt** | **3-4 calls** | **~10-12s** |

**10 prompts: 30-40 calls, ~2-3 minutes total.**

## Friction Points Encoded (Learned from Manual Submission)

These are hard-won lessons from submitting R01-R10 manually:

### 1. "Research" vs "Web search" — CRITICAL
- The "+" menu has TWO similar items: **"Research"** (magnifying glass) and **"Web search"** (globe + green checkmark)
- **You MUST click "Research"** to enable deep research mode
- "Web search" is a sub-feature — having its green checkmark does NOT mean Research is active
- The JS selector must match `text === 'Research'` exactly, NOT `text.includes('Research')` which could match "Cancel Research"

### 2. Research Does NOT Persist Between Conversations
- Every new prompt/conversation requires re-enabling Research
- The model selector (Opus 4.6 Extended) DOES persist
- MCP connector approval persists within a browser session (modal won't appear after first confirmation)

### 3. MCP Modal Appears on FIRST Research Enable Per Session
- First prompt: MCP modal appears → must click "Confirm"
- Subsequent prompts: Research enables immediately, no modal
- BUT: if the browser was refreshed or session expired, the modal reappears
- **Always check for the modal after sending**, don't assume it won't appear

### 4. The "+" Button Location
- It's the circular button on the LEFT side of the chat input bar
- Coordinates approximately (339, 331) on a 1441x852 viewport
- `aria-label="Add files, connectors, and more"` or just the first button in the fieldset

### 5. Prompt Pasting — execCommand Is Reliable
- `document.execCommand('insertText', false, text)` works with React's state management
- Must `focus()` the contenteditable first
- Must `selectAll()` before inserting (clears any existing text)
- The InputEvent fallback (`el.textContent = text; el.dispatchEvent(new InputEvent(...))`) works but sometimes React doesn't pick it up
- For prompts > 500 chars, ALWAYS use JS injection, never Chrome MCP `type` action

### 6. Send Button
- `aria-label="Send message"` or find by `button` with send icon
- It may be disabled briefly after pasting — the 300ms sleep after paste handles this

### 7. Research Verification
- After sending with Research enabled, you should see:
  - "Creating my research plan..." (in a collapsible section)
  - Or "Initializing research tools..."
  - Or "Getting your assistant ready..."
- If you just see regular thinking (no research indicators), Research was NOT enabled — the prompt was sent as a normal chat

### 8. Breadcrumb Navigation
- The project name in the top breadcrumb is a clickable link
- Format: "Native Apps Research / conversation-title"
- Click the project name part to return to the project page
- `a[href*="/project/"]` is a reliable selector

### 9. Race Conditions
- After clicking "Research", wait 500-800ms before interacting with the input
- After pasting, wait 300ms for React state to sync before clicking Send
- After clicking Send, wait 3-5s for the page to transition to the conversation view
- After clicking the breadcrumb, wait 2s for the project page to load

### 10. Viewport Size Matters
- All coordinates assume 1441x852 viewport
- If the browser window is a different size, use `find` or `read_page` for element refs instead of hardcoded coordinates

## Template: Complete Batch Submission

Here's the full orchestration pattern a Claude agent should follow:

```
# 1. SETUP
Read all prompt files into an array
Navigate to project URL
Take screenshot to verify project page

# 2. LOOP (for each prompt)
for i, prompt in enumerate(prompts):
    log(f"Submitting {i+1}/{len(prompts)}: {prompt.filename}")

    # 2a. Fast-path JS: click + → Research → paste → send
    javascript_tool(FAST_PATH_JS.replace('__PROMPT_PLACEHOLDER__', escape(prompt.content)))

    # 2b. Wait and check for MCP modal
    wait(4)
    screenshot()

    if MCP_MODAL_VISIBLE:
        left_click(889, 556)  # Click "Confirm"
        wait(3)
        screenshot()  # Verify research started

    # 2c. Verify research is running
    # Look for "Creating my research plan..." in the screenshot
    # If not visible, this prompt may have been sent as normal chat — FLAG IT

    # 2d. Navigate back to project
    javascript_tool(NAVIGATE_BACK_JS.replace('__PROJECT_URL__', projectUrl))
    wait(2)

# 3. REPORT
log("All prompts submitted!")
for each prompt:
    log(f"  {prompt.filename}: {'research' if verified else 'NEEDS VERIFICATION'}")
```

## Escaping Prompt Text for JS Injection

Prompts contain backticks, quotes, and special characters. The prompt text must be properly escaped before embedding in the JS template:

```javascript
// Escape strategy: use a function parameter instead of string interpolation
// The Chrome MCP javascript_tool `text` parameter handles the outer escaping
// For the prompt content, escape backticks and backslashes:
const escaped = promptText
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$/g, '\\$');
```

**Better approach:** Instead of string interpolation, store the prompt in a global variable first:

```javascript
// Call 1: Store prompt in window variable
window.__BATCH_PROMPT__ = `the escaped prompt text`;
'stored';

// Call 2: Execute the fast-path using the stored variable
(async () => {
  // ... click +, click Research ...
  const el = document.querySelector('[contenteditable="true"]');
  el.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, window.__BATCH_PROMPT__);
  // ... click send ...
})();
```

This avoids nested escaping issues entirely. Two JS calls instead of one, but much safer.

## Future Optimization: Full Pipeline JS

If the MCP modal stops appearing (already confirmed in session), the entire loop can be a single JS call with a `for` loop and `fetch()` to read prompts. But this requires:
- Prompts accessible via URL (not local filesystem)
- No MCP modal interruption
- Reliable DOM selectors that survive claude.ai updates

For now, the hybrid approach (JS for DOM manipulation + Chrome MCP for modal handling) is the most robust.
