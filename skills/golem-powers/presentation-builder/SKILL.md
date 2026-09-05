---
name: presentation-builder
description: "Build talks with Workshop/Oren/Uri methods. Triggers: talk prep, slides, pitch, practice, structure review."
---

> **Standing-preference binding (inherited from coach, inlined here for standalone use).**
>
> When the user states a stylistic/structural preference 2+ times in a session
> ("less terms", "fewer bullets", "more visuals", "premise-only", "no headers",
> "shorter", "denser", "simpler"), treat it as a STANDING preference for the
> rest of the session — not a per-turn correction. On the 2nd occurrence:
> self-prompt before every subsequent deliverable with
> `"STANDING PREFERENCE (this session): {verbatim quote}. Conform before deliver."`,
> run a self-check, and re-draft if non-compliant — do not deliver and ask
> "is this better?". If `brain_store` is available: at boot, first search for
> `tag:standing` entries from the last 2 hours with `valid_until` not expired —
> adopt their `session_id` if found (compaction-safe), otherwise mint a fresh
> `session-{YYYY-MM-DDTHH:MM:SSZ}` from `date '+%Y-%m-%dT%H:%M:%SZ'`. Tag
> entries with `session-preference + standing + {session-id}`, `importance:3`,
> and put both `session_id:` and `valid_until: end-of-session-...` in the body.
> Future-session searches must require `session_id` match (not just date)
> before applying. If `coach` is also loaded, prefer its canonical definition.

# Presentation Builder Skill

> Build great presentations step by step. Based on Michal's Speakers Workshop (TechGym/Melio), Oren Efraim's "Art of Building and Delivering Great Presentations", Uri Alon (Weizmann), and 6+ expert sources.
>
> Full rules reference (local, gitignored): `docs.local/speakers-workshop/presentation-rules.md`

## Usage

```text
/presentation-builder [workflow]
```

**Workflows:**
- `/presentation-builder premise` — Find and refine the single premise (Session 1)
- `/presentation-builder build` — Frame, draft with AI, polish, slides, opening/closing (Session 2)
- `/presentation-builder review` — Review and practice a finished presentation (Session 3)
- `/presentation-builder full` — Walk through the entire process start to finish
- `/presentation-builder rules` — Show all extracted presentation rules (quick reference)

---

## The Method (3 Sessions)

### Session 1: Find the Main Subject (Premise)

**Goal:** One sentence that captures the entire talk. Everything else flows from this.

**Process:**
1. Ask the user: "What's the talk about? Who's the audience? How long?"
2. Brainstorm 3-5 possible angles together
3. Narrow to ONE premise — it should be tweetable
4. Test: "If the audience remembers only one sentence, what is it?"

**Uri Alon's Rule:** Every good talk has ONE single premise. Write it FIRST. If a slide doesn't support it, cut it.

**Output:** A single premise sentence + audience definition + time constraint.

---

### Session 2: Build the Presentation

This is the main work session. Follow this order strictly:

#### Step 1: Frame the Structure

Use Oren Efraim's 10-minute structure (scales to any length):
1. **Hook** — grab attention (don't start with "about me")
2. **Problem** — what are we solving?
3. **Solution** — the answer
4. **Why this / Why us** — what makes it special?
5. **Summary** — callback to opening

Ask the user to map their content to these 5 sections.

#### Step 2: Build the First Draft with AI

Help the user write a prompt for AI to generate a first draft:
- Include: premise, audience, time limit, structure, key points per section
- Include: tone (casual/formal), language, any must-include stories or data
- The AI draft is a STARTING POINT, not the final product

#### Step 3: Polish and Synthesize (Michal's Rule)

Go through the draft and:
- **Cut ruthlessly** — if it doesn't serve the premise, remove it
- **Synthesize** — combine overlapping points, tighten language
- **One message per slide** (Oren Efraim's golden rule)
- **Kill bullet points** — max 3 per slide, or use images instead
- **Big text** — what looks good on laptop doesn't look good projected

#### Step 4: Content/Media (Do This BEFORE Opening/Closing)

For each slide, check:
- [ ] Does it convey exactly ONE idea?
- [ ] Is the text big enough to read from the back?
- [ ] Are bullet points minimized? (max 3, highlight one at a time)
- [ ] Colors: max 5, consistent palette
- [ ] Code: monospace, large, syntax highlighted, show LESS not more
- [ ] Charts: simplified, noise removed, key data highlighted
- [ ] Architecture diagrams: progressive reveal, not everything at once
- [ ] Numbers: big and prominent (they're proof, not the story)

**Oren Efraim:** 10-30 seconds per slide. If you need more time, split the slide.

#### Step 5: Opening and Closing (LAST — Michal's Rule)

**Opening is the LAST thing you write.** You need to know all your slides before you know the best hook.

**5 Hook Types (Oren Efraim):**

| Type | How | Example |
|------|-----|---------|
| Question | Trigger curiosity | "What happens when you build something for yourself and it becomes a system?" |
| Shared Pain | Empathy hook | "Remember deleting the production database?" |
| Personal Story | Create proximity | "Two years ago I couldn't speak in front of anyone..." |
| Stunning Fact | Challenge assumptions | "We see 1,200 presentations a year. We remember 3%." |
| Paint a Future | Optimism hook | "Imagine a world where every talk you give is remembered." |

**Closing:** The LAST point MUST callback to the opening. Full circle = closure.

**Session 2 output:** A complete presentation wireframe — structure, polished slides, opening, closing. Ready to practice.

---

### Session 3: Practice and Polish

**Goal:** Make the presentation as good as possible. Practice, get feedback, refine.

This is where you take the wireframe from Session 2 and turn it into a performance.

#### Practice Runs

- Practice **out loud** — don't just skim in your head (Oren Efraim)
- **Memorize only the first 30 sec - 2 min** — the opening must be smooth and powerful
- After opening, use slides as anchors — each slide = one message, talk naturally
- **Record yourself** (video) — watching yourself is the fastest improvement
- Time it: 1 minute = ~150 words
- Have water nearby — drinking = strategic pause

If voice is available (VoiceLayer), use `voice_ask` for practice runs:
- Speak the opening, get feedback
- Time the full run
- Note where energy drops

#### Review Checklist

- [ ] Premise is clear in the first 2 minutes
- [ ] Hook grabs attention (not "Hi, I'm X and today I'll talk about...")
- [ ] Each slide = one message
- [ ] Energy varies: warm (story) → cool (technical) → warm (insight) → cool (data) → warm (close)
- [ ] Closing callbacks to opening
- [ ] Timed and within limit
- [ ] First 30 sec - 2 min memorized cold

#### Feedback to Give/Look For

- Where did energy drop?
- Which slide felt too long?
- Was the hook compelling?
- Did the closing feel connected to the opening?
- Audience engagement: would you have stayed?

#### Present to the Group

Show your opening, get live feedback, iterate. This is the final polish before the real event.

---

## Delivery Rules (Quick Reference)

### Voice & Pace

- Speak clearly, vary pace — slow for important, faster for setup
- Use **methodical pauses** — silence after key points is powerful
- Water = strategic pause when rushing or confused

### Body

- Stand, don't sit. Use the stage. Hands visible.
- Face the audience, not the screen
- Eye contact with individuals (3-5 sec each), including back rows

### Nerves

- Reframe: excitement, not fear (same physical symptoms)
- Breathing: 5 sec in, 5 sec out (Huberman protocol)
- First 30 seconds are the hardest — it gets easier
- Know your first sentences cold

### DON'T

- Don't memorize word-for-word — sounds robotic
- Don't apologize ("This is my first time")
- Don't read slides with your back to the audience
- Don't switch languages mid-sentence (unless technical term)

### Environment

- Arrive early, check projector/adapter
- Close all notifications (DND mode)
- Know your mic type (Madonna = belt pack)
- Conferences are always cold — wear sleeves

### Audience Engagement

- Raise hands / small jokes work in most cases
- Have a comeback if audience doesn't participate
- **The Airplane! trick:** Plant a mystery number/fact at the start — someone will ask about it at the end (solves "no questions" problem)

### Q&A (Uri Alon)

- Listen to the full question
- Repeat it for the audience
- "I don't know" is valid — follow with "but here's what I think..."
- Long/confused questions: "Let me make sure I understand — are you asking...?"

---

## Voice Integration

When VoiceLayer is available, use it for:
- **Practice runs:** `voice_ask` — speak the opening, get timed feedback
- **Debrief after presenting:** `voice_ask` — "How did it go? What would you change?"
- **Quick notes during review:** `voice_speak` — capture insights silently (use `insight:` prefix)
- **Reading back the premise:** `voice_speak` — hear it spoken, check if it sounds natural

---

## Sources

- **Oren Efraim** — "The Art of Building and Delivering Great Presentations" (TechGym YouTube)
- **Michal** — Speakers Workshop at Melio (TechGym, Feb 2026)
- **Uri Alon** — "How to Give a Good Talk" (Weizmann Institute, PubMed)
- **Oren Eini** — Technical Presentation Delivery Notes (RavenDB/Ayende)
- **Ben Orenstein** — Speaking for Hackers
- **Method Queen** — How to Build a Good Lecture (Hebrew)
- **Harvard** — 10 Tips for Public Speaking
