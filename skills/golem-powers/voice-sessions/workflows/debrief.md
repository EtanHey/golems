---
name: debrief
description: Full voice-powered conversation debrief with probing questions
---

# Voice Debrief Workflow

## Prerequisites

- voicelayer MCP connected (`voice_ask`, `voice_speak`)
- Obsidian vault accessible

## Phase 1: Context Setup

Use `voice_ask` for each question. Wait for response before next question.

### Opening
```
voice_speak("Let's debrief your conversation. I'll ask you some questions and take notes.")
```

### Context Questions (ask in order, skip if already known)
1. "Who did you meet with, and what company?"
2. "What was this about — interview, coffee, discovery call?"
3. "How long did it go? Where was it?"
4. "What was the general vibe — casual, formal, intense?"

After each answer, use `voice_speak` to silently log key facts:
```
voice_speak("insight: Meeting with {name} at {company}, {type}, {duration}")
```

## Phase 2: Content Drilling

### Core Questions
5. "Walk me through it — what did you talk about first?"
6. "What questions did they ask you?"
7. "What did you tell them about yourself? What seemed to land?"
8. "What did you learn about the role or company that you didn't know before?"

### Follow-up Probing Rules
After each answer, evaluate:
- **Vague answer** → drill: "Can you be more specific about that?"
- **Interesting signal** → drill: "Tell me more about {specific thing}"
- **Skipped topic** → probe: "Did you talk about {salary/equity/tech stack/team}?"
- **Strong reaction** → explore: "You sound {excited/concerned} about that. Why?"

Use `voice_speak("insight: ...")` to track key points silently.

## Phase 3: Signals & Red Flags

9. "What were the positive signals? Anything that made you think 'this could work'?"
10. "Any red flags or things that worried you?"
11. "How did they react to your experience — what impressed them most?"
12. "Did anything feel off or unclear?"

Log red flags immediately:
```
voice_speak("insight: {flag description}")
```

## Phase 4: Decisions & Next Steps

13. "What are the next steps? Did they say what happens now?"
14. "Is there anything you need to prepare or send them?"
15. "Do you want to move forward with this? What's your gut saying?"

## Phase 5: Wrap-up

16. "Anything else you want to remember about this conversation?"

```
voice_speak("Got it. Writing up your debrief now.")
```

## Phase 6: Generate Journal Entry

Create Obsidian file at:
```
$OBSIDIAN_VAULT/Job Search/{Company} - {Date} Debrief.md
```

### Template:
```markdown
# {Company} — Debrief {Date}

## Context
- **Who:** {name}, {title}
- **Type:** {interview/coffee/discovery}
- **Where:** {location}
- **Duration:** {time}
- **Vibe:** {casual/formal/etc}

## Key Discussion Points
- {bullet points from phase 2}

## What Landed
- {things that impressed them}

## What I Learned
- {new info about role/company}

## Positive Signals
- {from phase 3}

## Red Flags / Concerns
- {from phase 3, or "None noted"}

## Action Items
- [ ] {follow-ups from phase 4}

## Next Steps
{what happens next}

## Gut Feeling
{user's overall impression}

## Raw Notes
{any additional details captured during debrief}
```

### After Writing:
1. Read back the file path to the user
2. Mention any action items with deadlines
3. If there are red flags, highlight them
4. Link to existing prep docs if they exist (e.g., meeting prep file)

## Adaptive Behavior

- **User is tired/short on time**: Skip to phases 1, 4, 5, 6 (context + decisions + wrap + journal entry)
- **User is energized/talkative**: Let them go, add follow-up probes
- **Multiple meetings same day**: Ask "which conversation?" first
- **Repeat meetings with same person**: Reference previous debrief, ask "what changed?"
