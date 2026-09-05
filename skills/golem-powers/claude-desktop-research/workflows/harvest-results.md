# Harvest Results Workflow

> **Goal:** Monitor a batch of claude.ai Research conversations, detect completion, export results, save them, notify, and run `brain_digest` on each.
>
> **How:** Poll the project page every 10 minutes. When a conversation's research is done (no spinner, full response visible), extract the text, save to two locations, and digest into BrainLayer.

## Harvest contract (dispatch time — `/research-lifecycle`)

Before starting this workflow, the dispatch MUST already name:

| Field | Required |
|-------|----------|
| `harvest_owner` | Who runs/monitors this harvest loop |
| `harvest_trigger` | What starts harvest (poll detects done, Etan says done, etc.) |
| `export_route` | Where results land for the fleet (`docs.local/research/`, Drive, collab ack) |

Without all three at dispatch, research is **parked** — do not mark the batch done.

## Overview

After batch-submitting N research prompts (via `fast-batch.md` or manually), each conversation runs deep research autonomously. Research takes 5-30 minutes per prompt depending on complexity. This workflow automates the harvest.

## Architecture

```
/loop 10m  (or manual trigger)
  → Navigate to project page
    → List all conversations, identify which are "done"
      → For each newly completed conversation:
        1. Open it
        2. Extract full response text via get_page_text
        3. Save to $ORCHESTRATOR_ROOT/docs.local/research/R{NN}-result.md
        4. Save to Obsidian batch folder (same location as prompts)
        5. Notify via Telegram
        6. brain_digest the result
      → Navigate back to project page
    → Check if ALL conversations are done → final summary notification
```

## Completion Detection

### How to Tell Research Is Still Running

When a Research conversation is in progress, the page shows one or more of these indicators:

- **Spinner/loading animation** — animated dots or a pulsing indicator
- **"Researching..."** text in the response area
- **"Creating my research plan..."** collapsible section (early stage)
- **"Searching the web..."** or **"Reading sources..."** (mid stage)
- **Partial response** — text is still being generated (streaming)
- **Stop button** visible (the square stop icon replaces the send button during generation)

### How to Tell Research Is Complete

A completed Research conversation shows:

- **Full response text** — no streaming, no loading indicators
- **Source citations** — numbered references at the bottom (e.g., `[1]`, `[2]`, ...)
- **No stop button** — the send button (arrow icon) is back
- **"Research complete"** or the research section is fully collapsed with a checkmark
- **The response ends cleanly** — no truncation, no "..."

### JavaScript Detection Function

```javascript
// Returns true if the conversation appears to be done
(function() {
  // Check for stop button (indicates still generating)
  const stopBtn = document.querySelector('button[aria-label="Stop response"]')
    || document.querySelector('button[aria-label="Stop"]');
  if (stopBtn) return { done: false, reason: 'Stop button visible — still generating' };

  // Check for loading/spinner indicators
  const spinners = document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="animate"]');
  const activeSpinners = [...spinners].filter(el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (activeSpinners.length > 0) return { done: false, reason: 'Spinner/loading animation visible' };

  // Check for streaming text indicators
  const streamingCursor = document.querySelector('[class*="cursor"], [class*="blink"]');
  if (streamingCursor) return { done: false, reason: 'Streaming cursor visible' };

  // Check for the presence of response content
  const responseBlocks = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (responseBlocks.length === 0) return { done: false, reason: 'No assistant response found' };

  // Check for source citations (strong signal of completion for Research)
  const lastResponse = responseBlocks[responseBlocks.length - 1];
  const text = lastResponse.textContent || '';
  const hasCitations = /\[\d+\]/.test(text);
  const hasSubstantialContent = text.length > 500;

  if (hasSubstantialContent) {
    return { done: true, hasCitations, contentLength: text.length };
  }

  return { done: false, reason: 'Response seems too short — may still be generating' };
})();
```

**Important caveats:**
- DOM selectors may change as claude.ai updates — verify with `read_page` if JS detection is unreliable
- Some Research responses are genuinely short (~500 chars) — use `read_page` + visual inspection as fallback
- The safest signal is: **no stop button** + **send button visible** + **substantial content**

## Step-by-Step Workflow

### Step 0: Setup — Build the Tracking Table

Before starting the loop, create a tracking structure:

```
# Tracking state (in-memory or scratchpad)
conversations = [
  { id: "R01", title: "R01: Always-On Daemon Architecture", status: "pending", url: null },
  { id: "R02", title: "R02: macOS Sequoia Global Hotkeys", status: "pending", url: null },
  ...
  { id: "R10", title: "R10: Gem Quality Scoring Feedback Loops", status: "pending", url: null },
]
```

Save this to `claude.scratchpad.md` so it persists across loop iterations.

### Step 1: Navigate to Project Page

```
navigate(projectUrl)  // https://claude.ai/project/019d3a9e-31a9-72cb-b4c5-e90f0263cf5e
wait(3 seconds)
screenshot()  // Verify project page loaded
```

### Step 2: List Conversations and Check Status

Use `read_page` to get the list of conversations in the project sidebar:

```javascript
// Get all conversation links in the project
(function() {
  const links = document.querySelectorAll('a[href*="/chat/"]');
  const conversations = [];
  for (const link of links) {
    const title = link.textContent?.trim();
    const href = link.getAttribute('href');
    if (title && href) {
      conversations.push({ title, href, url: 'https://claude.ai' + href });
    }
  }
  return JSON.stringify(conversations);
})();
```

Cross-reference with the tracking table to find conversations still marked "pending."

### Step 3: Check Each Pending Conversation

For each pending conversation:

```
1. navigate(conversation.url)
2. wait(5 seconds)  // Let the page fully load
3. Run the completion detection JS function
4. If done:
   a. Mark as "harvesting" in tracking table
   b. Proceed to Step 4 (export)
5. If not done:
   a. Log: "R{NN} still running — {reason}"
   b. Navigate back to project page
   c. Continue to next pending conversation
```

### Step 4: Export Completed Research

Use `get_page_text` or `javascript_tool` to extract the full response:

```javascript
// Extract the full assistant response (last message)
(function() {
  const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (messages.length === 0) return 'NO_RESPONSE_FOUND';
  const lastMsg = messages[messages.length - 1];

  // Get the full text content including formatting
  const text = lastMsg.innerText;

  // Also grab any source links
  const links = lastMsg.querySelectorAll('a[href]');
  const sources = [...links].map(a => ({
    text: a.textContent?.trim(),
    href: a.getAttribute('href')
  })).filter(s => s.href && !s.href.startsWith('#'));

  return JSON.stringify({
    content: text,
    contentLength: text.length,
    sourceCount: sources.length,
    sources: sources.slice(0, 50)
  });
})();
```

**Fallback:** If the JS extraction misses formatting, use Chrome MCP `get_page_text` which captures the full rendered page text. Then strip the page chrome (header, sidebar) and keep only the assistant response.

**For very long responses** (>50K chars): The JS function may truncate. In that case:
1. Use `get_page_text` for the full page
2. Or scroll through the response in chunks, extracting each visible portion

### Step 5: Save Results

Save to **two locations**:

#### Location 1: Orchestrator research folder
```
$ORCHESTRATOR_ROOT/docs.local/research/R{NN}-result.md
```

File format:
```markdown
# R{NN}: {Title} — Research Results

> **Source:** claude.ai Research (Opus 4.6 Extended)
> **Project:** Native Apps Research
> **Submitted:** 2026-03-29
> **Completed:** {timestamp}
> **Conversation URL:** {url}

---

{extracted response text}

---

## Sources

{list of source links from the response}
```

#### Location 2: Obsidian batch folder (same as prompts)
```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/personal/Claude Web Research/research-to-run/batch-native-apps/R{NN}-result.md
```

Same format as above. This puts results alongside the original prompts for easy cross-reference in Obsidian.

### Step 6: Notify

After each successful harvest:

```bash
notify "Research Done" "R{NN} ({title}) harvested — {contentLength} chars, {sourceCount} sources"
```

### Step 7: Navigate Back

```javascript
// Return to project page
const breadcrumb = document.querySelector('a[href*="/project/"]');
if (breadcrumb) {
  breadcrumb.click();
} else {
  window.location.href = 'https://claude.ai/project/019d3a9e-31a9-72cb-b4c5-e90f0263cf5e';
}
'NAVIGATED';
```

Wait 2 seconds, then continue to the next pending conversation.

### Step 8: Check if All Done

After checking all conversations in this loop iteration:

```
completed = conversations.filter(c => c.status === 'completed').length
total = conversations.length

if completed === total:
  → Final notification: "All {total} research prompts completed!"
  → Proceed to Step 9 (brain_digest)
  → Exit the polling loop
else:
  → Log: "{completed}/{total} done. Next check in 10 minutes."
  → Update scratchpad with current status
  → Wait for next loop iteration
```

### Step 9: Brain Digest All Results

After all conversations are harvested:

```
for each R{NN}-result.md:
  1. Read the file
  2. brain_digest(content)  // Extracts entities, relations, action items
  3. brain_store(
       content: "Research completed: R{NN} {title}. Key findings: {1-2 sentence summary}. {sourceCount} sources cited. Full results in docs.local/research/R{NN}-result.md",
       tags: ["research", "conclusions", "native-apps", "R{NN}"],
       importance: 8
     )
  4. Log: "R{NN} digested into BrainLayer"
```

After all digests complete:

```
brain_store(
  content: "Batch research complete: 10 Native Apps Research prompts submitted and harvested on 2026-03-29. Topics: daemon architecture, global hotkeys, native search UI, memory injection viewer, process status dashboard, real-time STT indexing, cross-repo pipeline contracts, command mode architecture, TTS queue UX, gem scoring feedback loops. All results digested into BrainLayer and saved to docs.local/research/.",
  tags: ["milestone", "research", "native-apps", "batch-complete"],
  importance: 9
)

notify "Batch Complete" "All 10 research results harvested and digested into BrainLayer"
```

## Polling Cadence

| Phase | Interval | Rationale |
|-------|----------|-----------|
| First 30 min | Every 10 min | Research typically takes 10-30 min |
| 30-60 min | Every 10 min | Some complex prompts take longer |
| After 60 min | Every 15 min | Reduce overhead; stragglers are likely complex |
| After 2 hours | Manual check | Something may have errored |

**Implementation:** Use `/loop 10m` for the first hour, then switch to manual checks if needed.

**Exit conditions:**
- All conversations harvested → exit loop
- Conversation stuck for >60 min with no progress → flag to user, skip, continue
- Page errors (403, session expired) → notify user, pause loop

## Error Handling

### Session Expired
Claude.ai sessions expire after ~4 hours of inactivity. If you get a login page:
1. Notify user: "Claude.ai session expired — please log in and tell me to resume"
2. Pause the loop
3. Do NOT attempt to log in

### Conversation Errored
If a Research conversation shows an error (e.g., "Something went wrong"):
1. Log the error
2. Mark the conversation as "errored" in the tracking table
3. Notify user: "R{NN} errored — may need manual resubmission"
4. Continue with other conversations

### Rate Limiting
If claude.ai shows a rate limit message:
1. Wait 5 minutes before retrying
2. Extend the polling interval to 15 minutes
3. Notify user if the rate limit persists

### Partial Response
If a conversation appears done but the response is suspiciously short (<500 chars):
1. Flag it: "R{NN} response seems truncated ({length} chars)"
2. Take a screenshot for manual review
3. Don't auto-harvest — mark as "needs-review"

## Optimized Call Count Per Check

| Step | Tool Calls | Time |
|------|-----------|------|
| Navigate to project | `navigate` (1) | ~3s |
| List conversations | `javascript_tool` (1) | ~1s |
| Per pending conversation: navigate + check | `navigate` + `javascript_tool` (2) | ~6s |
| Per completed: export + save | `get_page_text` + Write (2) | ~3s |
| Navigate back | `javascript_tool` (1) | ~2s |

**Per loop iteration (10 conversations, 3 newly done):**
- Navigate to project: 1 call
- List conversations: 1 call
- Check 7 pending: 14 calls (~42s)
- Harvest 3 done: 6 calls (~9s)
- Navigate back between: 3 calls (~6s)
- **Total: ~25 calls, ~60s per iteration**

## Quick Reference: File Paths

| What | Path |
|------|------|
| Prompt files | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/personal/Claude Web Research/research-to-run/batch-native-apps/R{NN}-*.md` |
| Result files (orchestrator) | `$ORCHESTRATOR_ROOT/docs.local/research/R{NN}-result.md` |
| Result files (Obsidian) | Same as prompt folder, with `-result.md` suffix |
| Tracking state | `claude.scratchpad.md` |
| Project URL | `https://claude.ai/project/019d3a9e-31a9-72cb-b4c5-e90f0263cf5e` |

## Template: Complete Harvest Loop

```
# 1. SETUP
Read scratchpad or initialize tracking table
Navigate to project URL
Take screenshot to verify

# 2. POLL LOOP (every 10 min)
while not all_done:
    navigate(projectUrl)
    conversations = list_conversations_js()

    for conv in conversations:
        if conv.status == 'completed':
            continue

        navigate(conv.url)
        wait(5)
        result = check_completion_js()

        if result.done:
            text = export_response_js()
            save(text, orchestrator_path)
            save(text, obsidian_path)
            conv.status = 'completed'
            notify("Research Done", f"R{conv.id} harvested")
            navigate_back()
        else:
            log(f"R{conv.id} still running: {result.reason}")
            navigate_back()

    update_scratchpad()
    log(f"{count_done}/{total} complete")

    if all_done:
        break
    wait(10 minutes)

# 3. DIGEST
for each completed result:
    content = Read(result_path)
    brain_digest(content)
    brain_store(conclusions, tags=["research", "native-apps", conv.id])

brain_store(batch_summary, tags=["milestone", "research", "batch-complete"])
notify("Batch Complete", "All results harvested and digested")
```
