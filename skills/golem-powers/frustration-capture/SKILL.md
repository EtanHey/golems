---
name: frustration-capture
description: "Store genuine user corrections/frustration after validating context and speaker intent. Triggers: no/wrong/stop, I told you, not that, profanity/frustration."
hooks:
  UserPromptSubmit:
    - hook: hooks/frustration-capture-prompt.py
      description: Auto-detect frustration patterns in user prompts and inject correction-capture guidance.
---

# Frustration Capture — User Correction Ground Truth

> "We should probably have filters to look for all my frustration when I start cursing and maybe even the amount of cursing I do."
> — User, April 4 2026 session (L2709-2711)

> "Search for 'frustration' or 'should have known' returned ZERO — meaning user corrections and frustration signals are NOT being captured."
> — Session mining finding (ST9)

BrainLayer has **ZERO records** of user corrections. This is the single biggest knowledge gap — corrections are the most valuable signals for improving agent behavior, and they're all being lost. This skill closes that gap.

---

## WHEN TO ACTIVATE

Activate this skill when a user message contains a genuine correction or frustration
signal. A lexical hook match is a candidate for validation, not proof that a
correction happened or that profanity concerns the current task.

### Tier 1: Direct Corrections (ALWAYS capture)
- **"No"** / **"Not that"** / **"Wrong"** / **"Stop"** — explicit negation of your action.
  Bare `no` counts only when it is a short standalone response or has a nearby
  correctee/contradiction signal. A corrected value supplied in the same clause,
  such as `No — the browser is Helium`, also counts. State/preference idioms such
  as `no need`, `no rush`, `no problem`, `no commit yet`, and conversation control
  such as `no, continue` do not count.
- **"I told you"** / **"As I said"** / **"We spoke about this"** / **"It's not new"** — repetition signal (user had to say it before)
- **"Wait, are we not doing X?"** — redirect, you drifted from the task
- **"What do you mean by X?"** — confusion about your claim/action
- **User provides the correct answer** after your wrong one — implicit correction

### Tier 2: Frustration Escalation (capture with HIGHER importance)
- **Profanity** — "this is fucking broken", "what the hell", "can you fucking read
  it", "damn it", "dumb ass". The deterministic hook treats this as a Tier 2
  candidate; validation decides whether it is genuine and task-related. A single
  first-time profanity signal remains importance 8.
- **Multiple negations** — "no no no no no"
- **All-caps** — "NEVER" / "STOP" / "WHY"
- **Exasperation markers** — "come on", "for fuck's sake", "are you serious"

### Tier 3: Sustained or Repeated Signals
- **Sustained directed profanity plus an imperative/repetition signal** — multiple
  expletives combined with `we need to`, `can you`, `I already said`, or equivalent
- **User does the task themselves** — they gave up on you doing it right
- **User offers a simpler solution** — "why not just X?" (you overcomplicated)
- **Short frustrated responses** — "no." / "wrong." / "ugh"
- **User re-explains the same concept** differently — they think you didn't understand

---

## WHAT TO CAPTURE

First check the surrounding exchange: identify the assistant claim/action being
corrected and confirm the words are from the user rather than quoted worker text,
a status relay, or a reviewer brief. If there is no real correctee or genuine
task-related frustration, do not store anything. When the signal is genuine, store it in
BrainLayer with this format:

```
brain_store(
  content: "USER CORRECTION [category]: I did [what you did wrong]. User wanted [what they actually wanted]. Quote: '[exact user words]'. Context: [1-sentence situation]. Behavioral rule: [what to do differently next time].",
  tags: ["user-correction", "frustration", "<category>", "<project>"],
  importance: <see scale below>
)
```

### Importance Scale

| Signal | Importance | Why |
|--------|-----------|-----|
| First-time correction, calm tone | 7 | Standard correction |
| Correction with frustration markers | 8 | User is annoyed — this matters more |
| Repeated correction (user said it before) | 9 | Pattern — you're not learning |
| Correction with profanity + repetition signal | 10 | Critical — user is considering giving up on you |

### Categories

| Category | Pattern | Example |
|----------|---------|---------|
| `routing-violation` | Wrong agent/tool for the task | "Cursor is for gathering, not implementing" |
| `fabrication` | Made up data, prices, facts | "Don't fake these data" |
| `scope-drift` | Doing the wrong task | "Wait, are we not doing /claude-desktop-research?" |
| `tool-misuse` | Wrong flag, wrong command, wrong tool | "orcClaude -s -c will continue you dummy" |
| `assumption` | Wrong personal/project fact | "I'm not a student" / "I use Helium" |
| `communication` | Didn't listen, unclear, repeated self | "I told you I want to not consume too much context" |
| `deferral` | Postponed when user wanted action | "Not good one for later" |
| `overcomplicate` | Made simple thing complex | "Why not just convert it?" |

---

## WHAT NOT TO DO

1. **Don't just apologize when the correction is real.** "Sorry about that" without
   a `brain_store` loses a genuine correction. Equally, never invent a correction
   merely because the hook matched a word.

2. **Don't argue, and don't stall.** When the user corrects you, they are RIGHT. ANSWER them first — the store rides the same turn, after the answer, never before it (Etan-ratified store-discipline: do the thing, then store). If you genuinely believe the user made an error, store the correction AND ask a clarifying question — but never push back on the correction itself.

3. **Don't store vague summaries.** "User was frustrated about routing" is useless. Store: exact quote, what you did wrong, what's correct, and the behavioral rule.

4. **Don't inflate importance.** A calm "no, use Cursor for that" is importance 7, not 10. Save 9-10 for repeated corrections with frustration.

5. **Don't capture user's emotional state.** This is NOT a mood tracker. Capture the CORRECTION (what you did wrong and what's right), not the EMOTION. The frustration level only affects importance scoring.

---

## MATCHER CONTRACT

The `UserPromptSubmit` hook is deterministic, fail-open, and makes no LLM call. It
runs these gates in order:

1. **Speaker/context gate:** suppress unambiguous harness prompts, agent relays,
   reviewer briefs, fleet ticks, spawn briefs, and structured ALL-CAPS
   worker-status escalations. Ambiguous prompts continue to the matcher.
2. **Correction evidence:** strong phrases such as `wrong`, `not that`, `I told
   you`, and `what do you mean` stand on their own. Bare `no` requires either a
   short standalone response, a nearby contradiction/correctee cue, or a
   clause-local supplied answer such as `No: the default branch is master`.
   Direct commands only count when they begin that same `no` clause (`No, use
   Helium`), not merely because `run` or `send` appears later in the prompt.
3. **Negative-context exemption:** ignore state/preference and navigation contexts
   such as `no need`, `no rush`, `no problem`, `no worries`, `no idea`,
   `no preference`, `no time`, `no budget`, `no doc`, `no reason`, `no commit yet`,
   `for no reason`, `no, continue`, and quoted matcher keywords.
   Historical/metalinguistic quotes are not live corrections.
4. **Weighted escalation:** profanity is a Tier 2 candidate even without an
   imperative (`this fucking sucks`, `for fuck's sake`); validation decides whether
   it is genuinely about the task. A single first-time profanity match stays at
   importance 8. Multiple f-word tokens plus an imperative or repetition cue
   promote the result to Tier 3; non-overlapping signals such as directed
   `bullshit` may add match weight.
5. **Advisory injection:** on a match, answer first, then check whether it is a
   genuine correction; store only if real. The hook never makes storage mandatory.

The hook remains bounded by its existing regex/deadline guards so it stays cheap on
every prompt.

## CORPUS DISCIPLINE

Production false positives and false negatives are matcher evidence. Add the raw
prompt verbatim to `hooks/tests/` with the expected fire/no-fire result and tier,
watch that test fail, and only then change the matcher. Do not add a one-off guard
without a corpus specimen, and do not weaken an existing true-positive fixture to
make a new negative case pass. The 2026-08-11/12 session corpus lives in
`hooks/tests/test_session_false_positive_corpus.py`.

---

## PROACTIVE MINING MODE

When mining session exports (JSONL or text), use these patterns to find corrections:

```python
# Tier 1: Direct corrections
patterns_tier1 = [
    r'\bnot that\b',          # "Not that"
    r'\bwrong\b',             # "Wrong"
    r'\bstop\b',              # "Stop doing X"
    r'I told you',            # Repetition signal
    r'as I said',             # Repetition signal
    r"it's not new",          # Repetition signal
    r'we spoke about',        # Repetition signal
    r'wait,?\s*(are|why)',    # Redirect
    r'what do you mean',      # Confusion about agent's claim
]

# Bare "no" is only a candidate after applying the matcher contract above:
# standalone short response OR nearby contradiction/correctee evidence, and not
# a status/preference/continuation/metalinguistic context.

# Tier 2: Frustration escalation
patterns_tier2 = [
    r'\b(motherfucker|fuck(ing|ed|er|s)?)\b',
    r'what the (hell|fuck)',
    r'damn it',
    r'dumb\s?ass',
    r'come on',
    r'(can|could|would|will) you .{0,80} fuck', # directed ask + expletive
    r'are you (serious|kidding)',
    r'no{3,}',               # "no no no no"
    r'[A-Z]{4,}',            # ALL CAPS words (4+ chars)
]

# Tier 3: Subtle
patterns_tier3 = [
    r'why not just',          # Simpler solution
    r"that's fine,?\s*I guess", # Gave up
    r'I can .* myself',       # User doing it themselves
]
```

When mining, extract:
1. The user message (exact quote)
2. The preceding agent message (what triggered the correction)
3. The category
4. The behavioral rule (what should happen next time)

---

## INTEGRATION WITH OTHER SKILLS

| Skill | How Frustration Capture Integrates |
|-------|-----------------------------------|
| `/agent-routing` | Routing violations are the #1 correction category (UC1-UC2) |
| `/orc` | R15 (BrainLayer store discipline) — corrections are the highest-priority stores |
| `/never-fabricate` | Fabrication corrections (UC4) compound with /never-fabricate rules |
| `/session-handoff` | Corrections must survive handoffs — store in BrainLayer, not just conversation |
| Session mining | Mining mode uses the regex patterns above to bulk-extract corrections |

---

## SELF-CHECK

After storing a correction, verify:

```
brain_search("user-correction <category>")
```

If the search returns your store → good. If it returns ZERO → the store failed or tags are wrong. Fix immediately. Evidence: April 4 mining found zero correction records despite 34 corrections across the session.

---

## EXAMPLE: Full Correction Capture Flow

User says: "No, I use Helium as my main, not Brave."

Agent should:

1. **Detect**: Tier 1 — direct correction ("No, I use X not Y")
2. **Categorize**: `assumption` — wrong personal fact
3. **Answer/Acknowledge** (FIRST, never after ceremony): "Got it — Helium is your main browser."
4. **Store** (same turn, after the answer):
```
brain_store(
  content: "USER CORRECTION [assumption]: I assumed user's main browser is Brave. User corrected: main browser is Helium, not Brave or Chrome. Quote: 'No, I use Helium as my main, not Brave.' Behavioral rule: never assume browser — check BrainLayer for user preferences before suggesting browser-specific actions.",
  tags: ["user-correction", "frustration", "assumption", "browser-preference"],
  importance: 7
)
```
5. **Verify**: `brain_search("user-correction browser")` → confirm stored
