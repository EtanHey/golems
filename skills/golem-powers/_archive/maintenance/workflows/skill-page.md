# Skill Showcase Page Workflow

> Phase 2 workflow for creating/updating skill showcase pages (eval results, model comparison, capability matrix).

## Prerequisites

- Fact brief from Phase 1 (gather-facts.md)
- Actual eval results from `evals/results/` or skill-evals runner output
- Current skill page content (if exists)

---

## Skill Page Norms

A skill showcase page proves the skill works. It does NOT dump SKILL.md contents.

### Required Sections

1. **What it does** — One sentence. "Generates personalized health schedules from WHOOP data."
2. **The delta** — Before/after: `+27pp` with skill vs without (coachClaude benchmark pattern)
3. **How to use it** — Trigger phrase, example prompt, example output
4. **What the AI sees** — The interface (tools used, BrainLayer queries, workflow routing)
5. **Eval results** — Actual test results, by assertion. GREEN/RED with counts.
6. **Model support** — Which CLIs/models support it. Capability matrix from adapters/capabilities.yaml.
7. **Changelog** — Recent changes to the skill (from git log or BrainLayer)

### Anti-patterns

- Dumping SKILL.md content as the page (that's the AI's interface, not the human's)
- Showing eval results without explaining what they test
- Claiming "100% pass rate" without showing test cases
- Model support matrix without explaining capability gaps
- "Works with Claude" without specifying which features degrade on other models

---

## Step 1: Gather Eval Data

Before spawning publicityAgent, collect actual eval data:

```bash
# Find eval files
ls <skill-path>/evals/

# Read eval results (if runner has been used)
cat <skill-path>/evals/results/*.json 2>/dev/null

# Read eval cases for assertion list
cat <skill-path>/evals/evals.json
```

Parse eval data into the fact brief format:
```
[EVAL-1] whoop-recovery-adaptation: 3/3 assertions GREEN (brain_search, zone awareness, specific adaptation)
[EVAL-2] credential-recovery: 4/4 assertions GREEN (1password-first, no-grep, knows-item, fallback)
[EVAL-GAP] No eval for voice mode persistence on Codex
```

---

## Step 2: Spawn publicityAgent

```text
You are publicityAgent drafting a skill showcase page for the <skill-name> skill.

Audience: Developers evaluating whether to install/use this skill.
Platform: etanheyman.com skill pages (Next.js, eval tab component)

Rules:
1. ONLY use facts + eval data from the fact brief.
2. Lead with the delta: "With skill: X% | Without: Y% | Delta: +Zpp"
3. Eval results must show actual assertion names and pass/fail, not just percentages.
4. The "What the AI sees" section should show the tool interface, not the prompt text.
5. Model support must be HONEST — if Codex can't do brain_search, say "degraded: no memory."
6. Never claim 100% unless every eval case actually passed.

Fact brief (includes eval data):
<fact-brief>

Current page (if exists):
<current-page>

Skill page norms:
<norms-from-above>
```

---

## Step 3: Verify Draft

Skill pages have unique verification needs:

1. **Eval accuracy** — Do the pass/fail counts match actual results? Read the files.
2. **Capability honesty** — If capabilities.yaml says `full_maintenance: false` for Codex, the page must reflect this.
3. **No eval fabrication** — If an eval hasn't been run, don't show results. Show "not yet tested."
4. **Trigger accuracy** — Does the "How to use it" section match the actual trigger in the skill description?
5. **Interface accuracy** — Does "What the AI sees" match the actual SKILL.md workflow routing?

---

## Step 4: Push-Pull Loop + Finalize

Same pattern as other workflows. Skill-specific feedback:

| Issue | Feedback |
|---|---|
| Fabricated eval | "EVAL-3 doesn't exist in evals.json. Remove or mark as 'planned.'" |
| Hiding capability gaps | "Codex has no brain_search. Add a 'Limitations' row to the model matrix." |
| Eval without context | "Show what 'brain_search_before_answer' actually tests, not just the name." |

Store on completion:
```text
brain_store(
  content: "Maintenance: Skill page for <skill-name> updated (<date>). Eval results: <pass>/<total>. Model support: <list>.",
  tags: ["maintenance", "skill-page", "<skill-name>"],
  importance: 6
)
```
