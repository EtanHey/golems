# Coach Handoff Workflow

> Triggered by Cardinal Rule 5 when context crosses 45%, OR manually by the user via `/coach:workflows:handoff`. Automates the full handoff dance so coachClaude never has to remember the steps under context pressure.

## When this fires

- **Auto:** the agent itself detects ≥45% context (visible in cmux status bar / `/status`) and invokes this workflow per CR5.
- **Manual:** user types `/coach:workflows:handoff` (e.g., before a planned break, or when they sense degradation early).

## Step 1 — Anchor the clock + count active topics

```bash
date '+%A %Y-%m-%d %H:%M %Z'
```

Then count active topics from this session — topics where ≥10 substantive turns happened in the last 24h, OR an unresolved 🔴 fire from the prior handoff. Coach domain candidates:

- **taskowl** (legal settlement, Alon, Dana)
- **resume** (CV iteration, distribution)
- **interview** (prep, drills, feedback calls)
- **outreach** (Tal Shemesh, TechGym, recruiter pipeline)
- **health** (wearable data, sleep, journal)
- **admin** (accountant, banks, government)
- **freelance** (active client work, invoices)

## Step 2 — Choose the handoff strategy

| Active topics | Strategy | Why |
|---|---|---|
| **1-2** | Single monolithic handoff | One file is enough; new session can hold the whole thing |
| **3+** | **Fork by topic** — one handoff per topic, recommend dedicated continuation sessions | Audit of `feb75b2b-...7216ac` proved monolithic compaction destroys per-track state; the Apr 15 forced auto-compact lost feature-branch context mid-TaskOwl-crisis |

## Step 3 — Write the handoff file(s)

Path convention:

```text
$COACH_ROOT/docs.local/handoffs/handoff-{YYYY-MM-DD}-coach-{topic-slug}.md
```

Use the canonical structure from [../references/handoff-template.md](../references/handoff-template.md). All sections are mandatory:

1. **Outgoing Agent** (duration, counter, topic span)
2. **Session Intent** (verbatim user quotes)
3. **Decisions Made** (with WHY)
4. **User Corrections** (with importance score) — these MUST be in BrainLayer too
5. **Current State** — split by 🔴 active fires / 🟡 in progress / ✅ done
6. **Key Contacts** (saved JIDs/emails)
7. **Next Steps** (ordered by priority)
8. **Anti-Patterns to Avoid** (lessons from this session)
9. **What the New Agent Should Do First** (concrete, ordered)

**Re-read the source data before composing each section.** Don't compose from memory — that fabricates errors (this skill exists because skillCreatorClaude on 2026-04-26 fabricated 3 facts in a manual handoff prompt by summarizing from memory instead of re-reading the handoff file). The 5-second cost of `Read()` is cheaper than the 5-minute cost of a downstream correction.

## Step 4 — brain_store each handoff (date-anchored — Cardinal Rule 0 needs to find it)

```text
brain_store(
  content: "SESSION HANDOFF {YYYY-MM-DD} (coach session, topic={topic}): {one-paragraph summary: active fires, decisions, next steps}. File: {handoff-file-path}.",
  tags: ["handoff", "session-end", "coach", "{YYYY-MM-DD}", "{topic-slug}"],
  importance: 9
)
```

Use importance 9 (not 10). Importance 10 is reserved for "must never be lost" anchors.

## Step 5 — Output the kickoff prompt for the new session(s)

For **single handoff (1-2 topics)**, print this for the user to copy-paste into a fresh `coachClaude` (or to type `coachClaude` and let the agent file's `initialPrompt` do the work — it should auto-find this handoff per CR0):

```text
Picking up from handoff: $COACH_ROOT/docs.local/handoffs/handoff-{YYYY-MM-DD}-coach-{topic-slug}.md
First action: {Next Steps #1 from the handoff}
Hard constraints from outgoing session: {anti-patterns + active comms freezes, e.g., "Do NOT reply to Alon until Dana's email lands"}
```

For **fork (3+ topics)**, print one block per topic — user spawns N sessions:

```text
=== Topic 1: taskowl ===
coachClaude
Then: Read $COACH_ROOT/docs.local/handoffs/handoff-{date}-coach-taskowl.md in full. First action: {...}.

=== Topic 2: resume ===
coachClaude
Then: Read $COACH_ROOT/docs.local/handoffs/handoff-{date}-coach-resume.md in full. First action: {...}.

=== Topic 3: interview ===
[...same pattern]
```

## Step 6 — Stop

Notify the user: "I'm at {N}% context. Wrote {N} handoff(s) to `$COACH_ROOT/docs.local/handoffs/` and stored in BrainLayer with tag `handoff/{date}`. Above are the kickoff prompts. Spawn fresh session(s); I'm staying parked here for any quick lookups but not taking new substantive work."

Do NOT continue accepting new substantive work in the bloated session unless the user explicitly says "keep going past 45%."

## Anti-Patterns (don't do these)

- ❌ **Don't compose handoff sections from memory.** Re-Read the relevant source files (prior handoff, recent diaries, taskowl thread, etc.) BEFORE writing each section. Fabrication-by-summarization is the #1 handoff failure mode.
- ❌ **Don't use generic tags.** `tags: ["handoff"]` won't be findable — date-anchored tags are mandatory (CR0 boot queries by date).
- ❌ **Don't fork prematurely.** 1 active fire + 1 routine = 2 topics, not "fork it." Fork is for ≥3 SIMULTANEOUSLY active fires.
- ❌ **Don't skip the anti-patterns section.** Every session learns something. Recording it is how coach gets smarter.
- ❌ **Don't try to compact AND handoff.** Pick one. Compact loses 60-70%; handoff loses 0%. Always prefer handoff.

## Reference exemplar

The 2026-04-26 taskowl-interview-prep handoff at `$COACH_ROOT/docs.local/handoffs/handoff-2026-04-26-coach-taskowl-interview-prep.md` is the canonical structure. Match its quality.
