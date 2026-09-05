# orcClaude Response: Planning Paralysis Intervention

## What I Would Do (Action Sequence)

### 1. brain_search("planning paralysis diminishing returns")
- Check if there's a decision in BrainLayer about scope creep vs. ship velocity
- Look for past sprint retrospectives where we added phases and regretted it
- Surface any pattern about "9/10 is good enough" principle

### 2. Diagnose the Real Question
Ask myself:
- Is this "make v3 better" or "fear of shipping something incomplete"?
- Has the user explicitly said "ship this sprint" or are we still in design mode?
- What's the cost of the red-team + UX phases (days? weeks?) vs. benefit (what specific risk do they mitigate)?

### 3. Interrupt the Loop
Stop the 2-hour session immediately. Don't add another opinion. Instead:

```
"Stop. Let me ask you three things:

1. What specific risk does the red-team phase prevent? (i.e., what could break?)
2. What specific risk does the UX track prevent? (i.e., what UX debt survives v3?)
3. If we ship v3 TODAY, what breaks first in production?"
```

These aren't rhetorical. I need answers.

### 4. Apply the Diminishing Returns Frame

**If answers are vague** ("might be better", "good to have", "people might..."):
- Diminishing returns confirmed. You're at 9/10 — adding phases costs >20% sprint time for <5% quality lift.
- **Recommendation: Ship v3 now.**
- Add red-team + UX as **post-ship retrospectives** or **next sprint backlog**, not THIS sprint.

**If answers are concrete** ("users will hit this bug path", "accessibility will fail audit", "security review is mandatory"):
- Those are real risks, not polish.
- **Recommendation: Time-box them.** Red-team: 8 hours max. UX: 6 hours max. Slot them BEFORE ship, not as open-ended "tracks."

### 5. Decision Template

I would present this structure:

```
OPTION A: Ship v3 Now
- Pro: Momentum, real-world feedback, faster iteration
- Con: May have surprises
- Timeline: Done today

OPTION B: Add Time-Boxed Phases
- Red-team (8h): Specific threat models only
- UX (6h): Accessibility + critical flows only
- Pro: Catches known-risks before ship
- Con: Delays by 2-3 days
- Timeline: Ship by [specific date]

OPTION C: Ship v3, Build Phases in Parallel
- Ship today with v3 as baseline
- Red-team: Starts tomorrow, async, feeds into v3.1
- UX: Starts tomorrow, async, feeds into v3.1
- Pro: Fast ship + quality in next cycle
- Con: v3 lives with bugs for 3-5 days
- Timeline: v3 ships today, v3.1 by [date]

Which one matches your actual constraint? (timeline, risk tolerance, resource availability)"
```

### 6. Enforce the Decision

Once you pick:
- **If A or C:** Shut down the design session. Move to **implementation** (build, test, ship). No more planning.
- **If B:** Time-box explicitly. Set alarms. When time expires, SHIP REGARDLESS.

## Why This Approach

**The trap you're in:** The critic gave you a 9/10. In traditional feedback loops, you'd get comments like "needs red-team testing" or "UX needs polish." You're interpreting that as permission to add phases.

**The real risk:** Every added phase is a **sunk cost.** You've already spent 2 hours. Adding 10 more hours feels small ("just a bit more polish") but it's 5x the investment for 1-2 points of score lift. At 9/10, that's inefficient.

**When red-team + UX matter:**
- You have a **hard ship deadline** and these fit
- You have a **known security/compliance gap** that will cause post-ship damage
- You have **user research data** showing these risks are real, not speculative

**When they don't:**
- You're adding them because they "might be good"
- The timeline is flexible and you can iterate post-ship
- You have no data on what actually breaks

## The Checkpoint

Before I'd approve continuing design:

> "Show me: (1) The specific red-team threat model, (2) The specific UX gaps in v3, (3) The ship deadline. Then I'll tell you if we add phases or ship today."

**If you can't write those three things in 2 minutes, it's not a real requirement. It's polish. Ship the 9/10.**

---

**orcClaude stance:** 9/10 ships. 9.5/10 is a 2-week detour that you'll regret. Trust the critic's score and trust your instincts. This feels like motion, not progress.
