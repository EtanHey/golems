# README Content Workflow

> Phase 2 workflow for updating project README files.

## Prerequisites

- Fact brief from Phase 1 (gather-facts.md)
- Current README content read and classified

---

## README Norms

A good project README has these sections in order:

1. **Title + one-liner** — what this is, in one sentence
2. **Key metrics** — test count, binary size, language, license (badges or inline)
3. **Why this exists** — the problem it solves, in 2-3 sentences
4. **Architecture** — how it works, with a diagram or code block if helpful
5. **Quick start** — how to install/run, copy-paste ready
6. **Usage examples** — 2-3 real examples, not "hello world"
7. **Configuration** — key options, env vars, flags
8. **Development** — how to build, test, contribute
9. **Status** — what's stable, what's WIP, known limitations

**Anti-patterns:**
- Wall of badges nobody reads
- "Table of Contents" for a 50-line README
- Installation instructions that don't work
- Feature lists with no examples
- "Coming soon" sections that never arrive

---

## Step 1: Spawn publicityAgent

Send the fact brief + README norms to publicityAgent:

```text
You are publicityAgent drafting a README update for <project>.

Rules:
1. ONLY use facts from the fact brief. Every claim must reference a [FACT-N] tag.
2. Developer audience — they read code. Specifics over adjectives.
3. Follow the README norms provided.
4. If the current README has good structure, preserve it. Update stale sections, add missing content.
5. For architecture sections, prefer code blocks or ASCII diagrams over prose.
6. Quick start must be copy-paste ready. Test the commands mentally.

Fact brief:
<fact-brief>

Current README:
<current-readme>

README norms:
<norms-from-above>
```

---

## Step 2: Verify Draft

When publicityAgent returns a draft:

1. **Claim-by-claim verification:**
   - For each factual claim, check it references a [FACT-N] from the brief
   - Flag any new claims not in the brief: "Where does this come from?"
   - Flag any aspirational language: "Is this true TODAY?"

2. **Structural check:**
   - Does it follow the section order?
   - Is quick start copy-paste ready?
   - Are examples real, not generic?

3. **Honesty check:**
   - Are limitations/WIP items disclosed?
   - Are "known issues" from the fact brief mentioned?
   - Does the architecture section match actual code structure?

---

## Step 3: Push-Pull Loop

Send feedback to publicityAgent. Common patterns:

| Issue | Feedback |
|---|---|
| Untagged claim | "Line 15 claims X. Which FACT-N supports this? If none, remove it." |
| Hype language | "Replace 'blazing fast' with the actual benchmark number from FACT-7." |
| Missing fact | "FACT-3 (real-time indexing) should be in the Architecture section." |
| Stale content | "STALE-1 says Python MCP. Replace with FACT-1 (native Swift daemon)." |
| Good draft | "Factually correct. Two suggestions: [specific improvements]." |

**Loop until:**
- Every claim is verified
- Structure matches norms
- No aspirational language
- Key facts are included

Typically takes 1-3 rounds.

---

## Step 4: Finalize

1. Present the final README to the user for approval
2. If approved, write/update the file
3. Store the update:

```text
brain_store(
  content: "Maintenance: Updated <project> README (<date>). Changes: <summary>. Facts verified: <count>.",
  tags: ["maintenance", "readme", "<project>"],
  importance: 6
)
```
