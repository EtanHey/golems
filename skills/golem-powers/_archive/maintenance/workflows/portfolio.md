# Portfolio Project Page Workflow

> Phase 2 workflow for creating/updating portfolio project pages on etanheyman.com.

## Prerequisites

- Fact brief from Phase 1 (gather-facts.md)
- Current portfolio page content (if exists)

---

## Portfolio Page Norms

A portfolio project page tells a recruiter or peer: "Here's what I built, why it matters, and proof it works."

### Required Sections

1. **Hero** — Project name, one-line description, key visual (screenshot/diagram/demo)
2. **The Problem** — What pain this solves, in human terms (not "I wanted to learn X")
3. **The Solution** — Architecture overview, tech choices, key design decisions
4. **The Numbers** — Before/after metrics, test counts, performance deltas. This is proof.
5. **How It Works** — 2-3 specific technical highlights with code snippets or diagrams
6. **My Role** — What YOU did vs what was collaborative/generated. Be specific.
7. **Lessons Learned** — 1-2 genuine insights, not platitudes
8. **Status + Links** — GitHub, live demo, related projects

### What Recruiters Actually Look At

- **First 5 seconds:** Title, one-liner, visual. Does this look real?
- **Next 30 seconds:** Numbers section. Can they verify quality?
- **If interested:** Architecture and role sections. Can this person explain decisions?
- **Never:** Long prose about "the journey" or "challenges faced"

### Anti-patterns

- "Built with React, Node, PostgreSQL" without saying WHY those choices
- Screenshots of a generic-looking app without context
- "Improved performance by 50%" without saying from what to what
- Feature lists without any indication of scale or complexity
- "Collaborated with team" without specifying your contribution

---

## Step 1: Spawn publicityAgent

```text
You are publicityAgent drafting a portfolio project page for <project>.

Audience: Senior developers, engineering managers, recruiters at tech companies.
Platform: etanheyman.com (Next.js, markdown content)

Rules:
1. ONLY use facts from the fact brief.
2. Lead with the most impressive specific number. "10 Python processes (931MB) replaced by 1 native daemon (40MB)" is a hook.
3. Show the delta — before/after is more compelling than the current state alone.
4. The "My Role" section must be specific: what Etan designed, implemented, decided.
5. Code snippets should be real (from the codebase), not illustrative pseudocode.
6. No filler sections. If there's nothing genuine to say about "Lessons Learned", skip it.

Fact brief:
<fact-brief>

Current page (if exists):
<current-page>

Portfolio page norms:
<norms-from-above>
```

---

## Step 2: Verify Draft

Pay special attention to:

1. **Attribution accuracy** — Does "My Role" correctly attribute what Etan did vs what agents/collaborators did? In this ecosystem, Claude agents do significant work. Be honest about the human-AI collaboration model.

2. **Number verification** — Every metric must trace to a FACT-N. Portfolio pages get scrutinized. Wrong numbers destroy credibility.

3. **Architecture accuracy** — Does the diagram/description match actual code structure? Read the real files if uncertain.

4. **Demo/link validity** — Are GitHub links correct? Is the demo actually live? Check.

5. **Honest scope** — Don't present a personal tool as a "platform" or a prototype as "production." Frame appropriately.

---

## Step 3: Push-Pull Loop

Common portfolio-specific feedback:

| Issue | Feedback |
|---|---|
| Vague role | "What SPECIFICALLY did Etan implement? List files, decisions, architecture choices." |
| Missing numbers | "The hero has no metrics. Add FACT-1 (the most impressive delta)." |
| Generic tech list | "Don't just list Swift/SQLite/FTS5. Say WHY: 'Swift for 209KB binary vs 50MB Python runtime.'" |
| Overstated scope | "This serves one user (the author). Frame as 'personal developer infrastructure' not 'platform.'" |
| Missing human-AI story | "This ecosystem uses AI agents extensively. That's a feature, not a secret. Add it." |

---

## Step 4: Finalize

1. Present final content for user approval
2. Format for etanheyman.com content system (markdown with frontmatter)
3. Store:

```text
brain_store(
  content: "Maintenance: Portfolio page for <project> created/updated (<date>). Key facts showcased: <list>. Honest about: <limitations/scope>.",
  tags: ["maintenance", "portfolio", "<project>"],
  importance: 7
)
```
