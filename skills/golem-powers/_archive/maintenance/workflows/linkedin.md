# LinkedIn Content Workflow

> Phase 2 workflow for LinkedIn posts and profile section updates.

## Prerequisites

- Fact brief from Phase 1 (gather-facts.md)
- Context: post vs profile update

---

## Compose with `/linkedin-post`

**The `/linkedin-post` skill has Aviv Levi's 2026 algorithm rules (data-backed, 11 rules).** Use it for drafting and review. maintenanceClaude's role is FACT VERIFICATION, not LinkedIn strategy.

### Workflow Integration

1. **maintenanceClaude** provides the verified fact brief (Phase 1 output)
2. **publicityAgent** drafts using `/linkedin-post` norms (Hook→Meat→CTA, dwell time optimization, mobile-first)
3. **maintenanceClaude** verifies every claim against FACT-N tags
4. If needed, use `/linkedin-post review` to check against the 11 algorithm rules

### Key `/linkedin-post` Rules (quick reference — full rules in that skill)

| # | Rule | Why |
|---|------|-----|
| 1 | Dwell Time > Likes | Algorithm counts seconds, not clicks |
| 4 | Mobile-first | 72% mobile, max 12 words/sentence |
| 7 | Saves > Comments > Likes | Save=100pts, Comment=10, Like=1 |
| 10 | Hook → Meat → CTA | Fixed structure every time |
| 11 | CTA in comments | Forces deeper engagement |

### maintenanceClaude-Specific Additions

These rules are NOT in `/linkedin-post` — they're about fact integrity:

1. **Specific > general** — "I replaced 931MB of Python with a 209KB Swift binary" > "I optimized my infrastructure"
2. **Show the journey honestly** — "I orchestrated AI agents to build this" is more interesting than pretending you hand-coded everything
3. **No cringe** — No "I'm humbled to announce", no "failure is just another word for learning", no inspirational quotes
4. **Hebrew or English** — Match the target audience. Israeli tech community = Hebrew is fine.

### Profile Section Updates

For experience/about/headline updates, use resume workflow norms but adapted for LinkedIn's format:
- Headline: `<Role> | <Key differentiator>` (max 120 chars)
- About: 3-4 sentences max. What you do, how you do it, proof it works.
- Experience bullets: Same XYZ formula as resume but can be slightly longer

---

## Step 1: Determine Post Type

| Type | When | Angle |
|---|---|---|
| Project launch | Major feature shipped / PR merged | Lead with the most impressive metric |
| Technical insight | Architecture decision / pattern discovered | Lead with the counterintuitive insight |
| Milestone | Test count reached / performance breakthrough | Lead with the number |
| Profile update | New role / project / capability | Update experience section |

---

## Step 2: Spawn publicityAgent

```text
You are publicityAgent drafting a LinkedIn <post/profile update> about <topic>.

Audience: Israeli tech community + international developer network.
Platform: LinkedIn (mobile-first, "see more" fold after ~2 lines).

Rules:
1. ONLY use facts from the fact brief.
2. Hook must work in 2 lines. Test: would YOU stop scrolling?
3. One idea. Not "here's everything I did this month."
4. If writing in Hebrew, follow references/hebrew-style.md rules (no em dashes, casual tone, 3 lines per paragraph).
5. The number is the proof. Without a number, it's just bragging.
6. AI collaboration is a feature: "I designed the architecture and orchestrated 3 AI agents to implement it in parallel" — that's impressive and honest.

Fact brief:
<fact-brief>

Post type: <type>
Language: <hebrew/english>

LinkedIn norms:
<norms-from-above>
```

---

## Step 3: Verify Draft

LinkedIn verification priorities:

1. **Hook test** — Read only the first 2 lines. Would you click "see more"? If not, rewrite.
2. **Claim verification** — Same as all workflows: every number traces to a FACT-N
3. **Tone check** — No cringe. No fake humility. No hype. Casual and specific.
4. **Single idea** — If the post tries to cover 3 topics, cut to the strongest one.
5. **Hebrew check** — If Hebrew: load references/hebrew-style.md, verify no em dashes, casual tone.

---

## Step 4: Push-Pull Loop

LinkedIn-specific feedback:

| Issue | Feedback |
|---|---|
| Weak hook | "The hook doesn't create curiosity. Try leading with the most surprising number." |
| Too long | "LinkedIn posts die after 1000 chars. Cut the middle paragraph." |
| Cringe opener | "Remove 'I'm thrilled to share.' Start with the fact." |
| Missing proof | "You claim it's fast but don't say how fast. Add FACT-5." |
| Multi-topic | "This covers daemons AND evals AND portfolio. Pick one." |

---

## Step 5: Finalize

1. Present final content for user approval
2. If Hebrew, double-check RTL rendering
3. Store:

```text
brain_store(
  content: "Maintenance: LinkedIn <post/profile> drafted (<date>). Topic: <topic>. Key fact used: <most impressive number>.",
  tags: ["maintenance", "linkedin", "<project>"],
  importance: 5
)
```
