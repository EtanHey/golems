# Resume Workflow

> Phase 2 workflow for updating resume sections with verified project facts.

## Prerequisites

- Fact brief from Phase 1 (gather-facts.md)
- Current resume content (user provides or brain_search for latest version)

---

## Resume Norms

Resume bullets must survive a 6-second scan. Every word earns its place.

### Format

```text
**Role/Project** — Organization/Context (Date range)
- Action verb + specific outcome + measurable result
- Action verb + specific outcome + measurable result
```

### Rules

1. **XYZ formula:** "Accomplished [X] as measured by [Y], by doing [Z]"
2. **Numbers are mandatory** — test counts, performance deltas, lines of code, time saved
3. **Action verbs:** Designed, Implemented, Reduced, Replaced, Orchestrated, Shipped
4. **No passive voice** — "Replaced 10 Python processes" not "Python processes were replaced"
5. **Honest attribution** — If AI agents did significant work, frame as "Designed and orchestrated AI agent workflow that..."
6. **Technology in context** — "Swift daemon (209KB)" not just "Swift" in a skills list
7. **Max 4 bullets per project** — prioritize by impressiveness, not completeness

### What ATS Systems Parse

- Job titles and company names (exact match matters)
- Technology keywords (match the job posting's language)
- Quantified achievements (numbers get highlighted)
- Date ranges (for tenure calculation)

### Anti-patterns

- "Responsible for maintaining..." (passive, no outcome)
- "Worked on various projects..." (vague, no specifics)
- "Utilized cutting-edge technologies..." (hype, no substance)
- Listing 30 technologies without context
- Including irrelevant personal projects

---

## Step 1: Spawn publicityAgent

```text
You are publicityAgent drafting resume bullets for <project/role>.

Audience: Recruiters scanning for 6 seconds, then hiring managers reading closely.
Format: Markdown bullets, XYZ formula, 4 bullets max.

Rules:
1. ONLY use facts from the fact brief.
2. Every bullet has a number. "Designed daemon replacing 10 processes (931MB -> 40MB)" not "Optimized memory usage."
3. Frame AI collaboration honestly: "Orchestrated 3 parallel AI agents" is a strength, not a weakness.
4. Technology names match industry conventions (Swift not swift, SQLite not sqlite).
5. If Etan's role was architecture/orchestration, say that. Don't claim implementation if agents coded it.

Fact brief:
<fact-brief>

Current resume section (if exists):
<current-section>

Target role keywords (if provided):
<keywords>
```

---

## Step 2: Verify Draft

Resume verification has different stakes — wrong claims on a resume are career-ending.

1. **Number accuracy** — Every number must be verifiable from git/tests/benchmarks
2. **Role accuracy** — Was Etan the designer, implementer, reviewer, or orchestrator? Be precise.
3. **Timeline accuracy** — Date ranges must match actual work periods
4. **Technology accuracy** — Don't list technologies that were only tangentially involved
5. **No inflation** — "10 Python processes" is impressive enough. Don't round up to "dozens."

---

## Step 3: Push-Pull Loop

Resume-specific feedback:

| Issue | Feedback |
|---|---|
| No numbers | "Every bullet needs a number. What's the test count? The size delta? The time saved?" |
| Wrong role | "Etan designed the architecture. brainClaude implemented it. Say 'Designed + orchestrated.'" |
| Technology inflation | "Remove Kubernetes — this project doesn't use it." |
| Too many bullets | "Max 4. Cut the weakest one." |
| Passive voice | "Change 'was replaced' to 'Replaced'." |

---

## Step 4: Finalize

1. Present final bullets for user approval
2. Match formatting to user's resume template
3. Store:

```text
brain_store(
  content: "Maintenance: Resume bullets for <project> updated (<date>). Key metrics: <top numbers>. Role framed as: <role description>.",
  tags: ["maintenance", "resume", "<project>"],
  importance: 7
)
```
