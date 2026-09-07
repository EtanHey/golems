# Multi-Round QA Iteration

## The QA Cycle

```
Round N: Checklist → Record → Process → Findings → Handoff → Agent Fixes → Verify
    ↓
Round N+1: Updated Checklist (retest fixes + new areas) → Record → ...
```

Expect **3-6 rounds** per feature. Each round gets tighter — early rounds find big bugs, later rounds catch polish and regressions.

## Starting a New Round

### 1. Reset Test Data (if applicable)
If the app uses demo/seed data that gets modified during testing:
```
# Convex: reset demo data
npx convex run demo:resetDemoData && npx convex run demo:seedDemoData

# Or use admin UI "Reset Demo" button if available
```

### 2. Update the QA Checklist

Load the previous round's findings and update the checklist:

```markdown
# QA Checklist — [Feature] — Round [N]

## Retest (from Round [N-1])
- [ ] [Fix 1 from last round — verify it's actually fixed]
- [ ] [Fix 2 — especially recurring bugs]
- [ ] [Fix 3]

## New Areas (not covered in previous rounds)
- [ ] [anything not yet tested]

## Regression Check
- [ ] [Core flows still work after fixes]
```

**Critical:** If a bug was marked "fixed" in the previous round but has appeared before, escalate it to CRITICAL and add root-cause investigation instructions.

**Checklist naming:** In the project documentation or the user's chosen notes
app, use round-specific filenames (`qa-round-5-checklist.md`,
`qa-round-6-checklist.md`) — do NOT overwrite previous round checklists.
They're useful for history.

### 3. Recording Format Evolution

Based on what worked across 7 rounds (qwan-drill session, March 2026):

| Round | Best approach |
|-------|---------------|
| 1-2 | Voice-to-Claude (quick, interactive, good for discovery) |
| 3-4 | Screen recording (user can focus on testing, not documenting) |
| 5+ | Screen recording with click capture (full traceability) |

Early rounds benefit from interactive back-and-forth. Later rounds benefit from focused, uninterrupted testing with video.

### 4. Track Round History

Maintain a summary across rounds:

```markdown
## QA Round History — [Project]

| Round | Date | Duration | Findings | Critical | Fixed | Persisting |
|-------|------|----------|----------|----------|-------|------------|
| 1 | 2026-03-23 | 15min human | 4 | 2 | 4/4 | 0 |
| 2 | 2026-03-23 | 17min human | 9 | 3 | 8/9 | 1 |
| 3 | 2026-03-23 | 7min human | 4 | 0 | 4/4 | 0 |
| 4 | 2026-03-23 | 6min human | 6 | 4 | 5/6 | 1 |
| 5 | 2026-03-23 | 11min human | 10 | 3 | 9/10 | 1 |
| 6 | 2026-03-23 | 25min human | 15 | 4 | TBD | TBD |
```

### 5. Decision: Continue or Ship?

After each round, assess:

- **0 critical, 0 major:** Ready to ship / demo
- **0 critical, some minor/UX:** Ship with known issues documented
- **Any critical:** Must do another round
- **Same bug 3+ rounds:** Escalate to human pair-debugging — the agent fix approach isn't working for this bug

### 6. Store Round Completion

```
brain_store(
  content: "QA Round [N] complete — [Project]. [X] findings, [Y] critical.
  Fixes: [N/M] verified. Persisting: [list].
  Decision: [continue/ship/escalate]. Next: [round N+1 focus areas]",
  tags: ["qa", "<project>", "round-N", "qa-complete"],
  importance: 7
)
```

## Session Directory Convention

```
docs/qa-session-YYYY-MM-DD-HHMM/
├── audio.wav                    # Round 1
├── transcript.srt
├── transcript.txt
├── frames/
│   ├── interval-0s.jpg
│   ├── interval-30s.jpg
│   ├── hotspot-154s-at.jpg
│   └── ...
├── qa-findings.md               # Round 1 findings
├── audio-round2.wav             # Round 2
├── transcript-round2.srt
├── frames-round2/
├── qa-findings-round2.md
├── ...
└── qa-round-history.md          # Summary across all rounds
```

**Video files:** Move screen recordings to the session directory and rename:
```
qa-round-1-recording.mov
qa-round-5-recording.mov
```
This creates a traceable archive of every round's raw footage.
