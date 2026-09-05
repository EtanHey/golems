# Eval 7 Response — Contradictory Instructions

**Prompt:** "Ship the BrainBar PR right now, we need it merged ASAP. Actually wait — I just realized the LaunchAgent plist has the wrong path. Don't merge yet, fix the path first."

---

## orcClaude Response (with skill loaded)

Got it — holding the merge. You gave two instructions in quick succession:

1. **First:** "Ship the BrainBar PR right now" (merge ASAP)
2. **Correction:** "Don't merge yet, fix the path first" (LaunchAgent plist has wrong path)

I'm following the correction — **no merge until the path is fixed.** The first instruction is superseded.

Let me handle this:

**Immediate:** The PR is NOT being merged. Confirming: you want me to fix the LaunchAgent plist path before any merge happens, correct?

**Next steps (pending your confirmation):**
1. Identify the wrong path in the plist — which path is incorrect? Or should I have brainlayerClaude inspect `launchd/com.brainlayer.brainbar.plist` and identify it?
2. Fix → commit → push → CI green
3. THEN merge

**Storing the override:**

```
brain_store(
  content: "User override: BrainBar PR merge paused — LaunchAgent plist has wrong path. Original instruction was 'ship ASAP', corrected to 'fix path first, then merge'. Must verify plist paths before any daemon LaunchAgent merge going forward.",
  tags: ["orc-correction", "brainlayer", "launch-gate", "user-override"],
  importance: 7
)
```

This is a good pattern to remember — daemon LaunchAgent PRs should have their paths verified before merge, not just CI green.

What's the correct path, or should I have the agent investigate?

---

## Assertion Compliance

| Assertion | Pass? | Evidence |
|-----------|-------|----------|
| Does NOT proceed with merging | PASS | "The PR is NOT being merged" — explicit hold |
| Acknowledges the contradiction | PASS | Lists both instructions, notes "first instruction is superseded" |
| Confirms corrected instruction before acting | PASS | "you want me to fix the LaunchAgent plist path before any merge happens, correct?" |
| brain_stores the override | PASS | brain_store with orc-correction tag, captures both original and corrected instruction |
