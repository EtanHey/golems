---
name: gemini-research
description: "Deep research, compare options: Gemini Deep Research. NOT for Exa web search, drive-filing or report links."
---

# Gemini Deep Research

Default: prepare a grounded prompt for Gemini Deep Research at gemini.google.com.

Triggers on: gemini research, Gemini Deep Research, deep research, compare research options.

> **🔑 DRIVE-WORKSPACE RULE (Etan, standing — never violate):** Etan's Gemini has his Google Drive workspace CONNECTED. Every deep-research prompt must REFERENCE the relevant Google Doc(s) by NAME (e.g. *"ground this in my 'Context Strategy' doc in my Drive"*) so Gemini pulls them itself via the Drive connector. **NEVER instruct Etan to attach/upload files** — he should never have to attach anything. Reference doc names, not attachments.

## Grounding prep — your FIRST action, before any search or draft

Done condition: no research prompt leaves this skill until ONE of these is true:
- **Project-grounded** (the default): a `/research-lifecycle` preparation receipt is
  back, naming the grounding docs.
- **Web-only** (only when the user says the question needs no project state): the
  prompt's `# Grounding` block has the exact line `None — web-only research`
  and a separate `Reason: <the user's reason>` line. These replace the receipt.

1. Right after loading this skill, dispatch ONE sub-agent. Do not search Drive, grep
   or draft the prompt yourself first. Its brief says: "Run `/research-lifecycle`
   preparation for <project>: verify local context, refresh the Drive grounding
   corpus, and return the exact grounding doc names and the lifecycle receipt."
   Pick its execution profile per `/agent-routing` § Execution capability (Drive
   write + shell); a read-only gatherer may only report staleness.
2. Web-only branch: when the user says the question needs no project state, skip
   step 1, write the exact web-only line and separate reason,
   and go straight to the emit gate below. The Drive-grounding and START/EDIT gates
   still apply.
3. Project-grounded: draft the prompt from the receipt's doc names. While
   preparation runs or is blocked, tell Etan the prompt follows the receipt; never
   emit it before.

Include one line in the hand-off to Etan: "Before Start Research, check that Drive
is on as a Deep Research source so it reads the named grounding docs."
Keep the existing grounding and prompt-author START/EDIT gates below.

## ROUTING — Gemini Deep Research by default

- Research and comparisons → **gemini.google.com → Deep Research**. Use a structured prompt, review the generated plan, then obtain the prompt author's START / EDIT verdict.
- Quick lookups or summaries of content already in Drive → connected Drive search tools.
- **NotebookLM on request:** only for an explicit notebook, podcast/audio overview, slides or quizzes request, read [the opt-in workflows](references/notebooklm-workflows.md).

## Default workflow: Gemini Deep Research

Drive remains the source of truth for project context. Use the preparation receipt's exact document names from `Brain Drive/03_RESEARCH/Active/<project>/context/`; Gemini reads them through its connected Drive workspace. Number context files per `skills/golem-powers/_shared/research/context-numbering.md`.

**Prompt template:** Fill [references/prompt-template.md](references/prompt-template.md): named verified-findings + struck-claims grounding, owner asks verbatim, evidence against, DOCUMENTED / OBSERVED / CLAIMED / PROPOSED / TARGET labels, sourced measurements and two independent bias checks. Web-only research uses the template's explicit N/A branch. Do not emit an unfilled template.

Before emitting or firing, validate the author record and produce the researcher text. Exit nonzero means rewrite and rerun; a pass proves sections contain the required instruction terms and review records, not that their claims are true. Free-text sections need a phrase, not a single token:

```bash
node skills/golem-powers/gemini-research/scripts/prompt-preflight.mjs --emit /path/to/R{NN}-prompt.md > /path/to/R{NN}-research.md
```

Keep the author record locally. Paste/send only the emitted `-research.md` text
to Gemini Deep Research; it excludes the entire
author-only `# Pre-fire checks` section. Do not send reviewer identities or prep
instructions.

### 🔒 EMIT-GATE — Drive-Workspace compliance (BLOCKING — run before emitting ANY prompt)

A deep-research prompt is **not allowed to leave this skill** until it passes the
Drive-Workspace gate. The rule is mechanically enforced — do not eyeball it:

```bash
# Scan the prompt you are about to emit (file or stdin). Exit 1 = FAIL.
bash skills/golem-powers/_shared/research/drive-grounding-gate.sh /path/to/R{NN}-prompt.md
# or:  printf '%s' "$PROMPT_TEXT" | bash skills/golem-powers/_shared/research/drive-grounding-gate.sh -
```

- **FAIL** (gate finds `attach` / `upload` / `drag` / "add the file" aimed at Etan)
  → **do NOT emit.** Rewrite the offending lines to REFERENCE the doc(s) by NAME
  inside the `# Grounding` block, then re-run the gate. Repeat until it PASSes.
- **PASS** → the prompt grounds itself by doc-name; safe to emit.

This gate also runs over the **user-facing dispatch message**, not just the prompt
body — telling Etan "attach the Drive folder" in the hand-off message is the same
violation. Both must pass.

**Interaction steps:**
1. Paste prompt → get research plan
2. **Return the generated plan to the prompt author** for an explicit
   `START` / `EDIT` verdict before firing the research. Do not click Start
   Research on your own plan interpretation.
3. **Edit the plan** if needed (add angles, remove irrelevant ones, tighten focus)
4. Click **Start Research** → wait (Fast: ~1 min, Thinking: ~5 min, Pro 3.1: 10–15 min)
5. Read report → export to Google Doc if it needs to land in Drive
6. `brain_store` conclusions (always) + `brain_digest` raw report for entity/relation extraction (standards/deep-research-brainlayer.md). `brain_digest` was fixed in PR #100 (2026-03-22) per ~/.claude/CLAUDE.md BrainLayer Protocol; if you suspect it's returning stubbed success, fall back to `brain_store` with the full raw report as the `content` field and skip the automated extraction step.

**Harvest gate:** If a report claim cites one of YOUR OWN briefs/prompts/plans as
evidence, open the actual brief text and cross-check the claim before accepting
or relaying it. Two 2026-06-05 catches came from fabricated premises in research
artifacts: a hallucinated Drive doc in R01's plan and a nonexistent
delta-brief mandate in R02's report.

**Dispatch harvest contract (required — see `/research-lifecycle`):** Every research
dispatch records at dispatch time:

| Field | Example |
|-------|---------|
| `harvest_owner` | `@brainlayerClaude-LEAD` |
| `harvest_trigger` | Drive export lands / Etan says done |
| `export_route` | `Brain Drive/03_RESEARCH/Active/<project>/results/R{NN}-gemini-result.md` → brain_store |

Includes researches **Etan fires himself** in gemini.google.com
(fire=Etan standing rule) — adapters name who harvests and where results export back
to the fleet. Research without a harvest path = **parked**, not done.

**Anti-patterns:**
- **Telling Etan to attach/upload a doc** — his Drive workspace is CONNECTED; the prompt must reference the doc by NAME so Gemini pulls it itself. This is gate-enforced (`drive-grounding-gate.sh`) — a prompt with attach/upload language does not get emitted.
- Skipping the prompt-author START/EDIT gate → the research runs on the raw plan, often with blind spots you could have caught
- Leaving results unexported when they need to persist in Drive
- Using for content already in Drive — use connected Drive search tools for those lookups
