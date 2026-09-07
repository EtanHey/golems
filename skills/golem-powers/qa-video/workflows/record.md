# Pre-QA: Checklist Generation + Recording Setup

## Step 1: Generate QA Checklist

Before the user records, generate a structured checklist of what to test. This ensures the recording covers everything and nothing is missed.

**Template:**
```markdown
# QA Checklist — [Feature/Component] — Round [N]

## Critical Paths (test these first)
- [ ] [Primary user flow 1]
- [ ] [Primary user flow 2]
- [ ] [Error state / edge case]

## Previously Fixed (retest these)
- [ ] [Bug from round N-1 — verify fix]
- [ ] [Bug from round N-1 — verify fix]

## New Areas
- [ ] [Newly implemented feature]
- [ ] [UI changes]

## Regression Check
- [ ] [Core feature still works after changes]
- [ ] [Related feature not broken]
```

**How to populate:**
1. `brain_search("qa <project> round <N-1> findings")` — what was found last round
2. Read the last findings doc if it exists (`docs/qa-session-*/qa-findings*.md`)
3. Check recent git commits for what changed since last QA round
4. Ask the user: "Anything specific you want to focus on?"

**Store the checklist** by default as
`docs/qa-session-YYYY-MM-DD-HHMM/qa-round-N-checklist.md` in the project being
tested. Use the user's chosen notes app instead when they request
mobile/side-by-side viewing. Do not assume a private vault name or
machine-specific storage path.

## Step 2: Coach Narration Style

Tell the user:

> **Narration tips for this recording:**
> 1. **Narrate BEFORE you act:** "I'm about to click [button] on [page]" → click → describe result
> 2. **State the flow:** "Testing checklist item 3 — user registration"
> 3. **Describe what you SEE, then what you EXPECTED:** "I see [X] but expected [Y]"
> 4. **Call out the exact UI element:** "The Submit button in the top-right" not just "that button"
> 5. **Pause between findings** — a 2-second silence between issues helps transcript segmentation

## Step 3: Start Recording

**Option A: With click capture (recommended)**
```bash
ORCHESTRATOR_REPO="${ORCHESTRATOR_REPO:-$HOME/Gits/orchestrator}"
bash "$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh" "$HOME/Gits/<project>/docs/"
```
This starts the click logger AND opens screen recording. Ctrl+C when done.

**Option B: Manual**
1. `Cmd+Shift+5` → Record Selected Portion (select the app window)
2. Test following the checklist
3. Stop recording when done
4. Move the .mov file to the session directory

## Step 4: Start Timer (if tracking effort)

If the project tracks human QA time:
```
Timer started: [HH:MM]
QA Round [N] — [Feature/Component]
```

Log timer start in `docs/decisions.md` or equivalent project tracking doc.

## After Recording

Tell the user: "Recording done? Give me the video path and I'll process it."
Then route to [workflows/process.md](process.md).
