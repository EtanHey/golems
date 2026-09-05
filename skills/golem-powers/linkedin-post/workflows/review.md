# Review a LinkedIn Post Draft

Score a draft against the 11 LinkedIn algorithm rules. Gives specific, actionable feedback.

## Input

User provides a draft to review (paste or file path).

## Steps

### 1. Score Against Each Rule

Check the draft against all 11 rules. For each:

| # | Rule | Pass/Fail | Issue (if fail) |
|---|------|-----------|-----------------|
| 1 | Dwell Time | Pass if estimated read > 30s | "Too short — add 2-3 more points" |
| 2 | PDF/Carousel | N/A for text posts | Suggest carousel if content is step-by-step |
| 3 | Zero-Click | Fail if links in body | "Move link to first comment" |
| 4 | Mobile-first | Fail if sentences > 12 words | Quote the long sentence, suggest shorter version |
| 5 | Personal > Company | Pass if from personal voice | "Sounds too corporate — add 'I' statements" |
| 6 | Golden Hour | Reminder only | "Block 90 min after posting" |
| 7 | Saves focus | Pass if content is save-worthy | "Add a checklist or numbered framework" |
| 8 | Consistency | Reminder only | "This is post X of your 5/week goal" |
| 9 | Authentic | Pass if no stock photo refs | "Add a real photo suggestion" |
| 10 | Structure | Check Hook/Meat/CTA | "Hook is 5 lines — cut to 3" |
| 11 | CTA in comments | Fail if CTA has link | "Move this to first comment" |

### 2. Specific Line Feedback

For each issue found, quote the exact line and suggest a fix:

```
Line 5: "We implemented a comprehensive solution for managing distributed..."
Issue: 9 words but feels corporate. Also "comprehensive solution" is filler.
Fix: "We built a system that handles distributed state across 6 agents."
```

### 3. Dwell Time Estimate

Count words, estimate read time:
- Average reading speed: 200-250 words/minute
- LinkedIn scroll speed: faster (assume 150 wpm for mobile)
- Target: 30-60 seconds (75-150 words for text posts)

```
Word count: [N]
Estimated read time: [X] seconds
Verdict: [Good / Too short / Too long]
```

### 4. Mobile Preview Estimate

Check how it looks on a small screen:
- Lines over 40 characters wrap awkwardly on mobile
- Paragraphs over 3 lines feel like "wall of text"
- The "See more" fold on LinkedIn is ~3 lines — hook must be above it

```
Lines before "See more" fold: [N]
Hook visible before fold: [Yes/No — if No, shorten hook]
Longest line: [N] chars (recommend < 40)
```

### 5. Output Format

```
## LinkedIn Post Review

**Overall Score: X/11 rules passed**

### Rule-by-Rule

| # | Rule | Result | Notes |
|---|------|--------|-------|
| 1 | Dwell Time | [pass/fail] | [detail] |
| 2 | Format | [pass/N/A] | [detail] |
...

### Specific Fixes

1. **Line X:** [quote] -> [suggested fix]
2. **Line Y:** [quote] -> [suggested fix]

### Metrics
- Word count: [N]
- Read time: [X]s
- Mobile preview: [Good/Needs work]

### Verdict
[One sentence: "Strong draft, fix the hook and move the link. Ready to post after those changes."]
```
