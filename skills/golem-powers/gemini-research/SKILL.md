---
name: gemini-research
description: "Deep research, compare options: Gemini Deep Research. NOT for Exa web search, drive-filing or report links."
---

# Gemini Deep Research

Default: prepare a grounded prompt for Gemini Deep Research at gemini.google.com.

Triggers on: gemini research, Gemini Deep Research, deep research, compare research options.

> **Grounding default: attach files, Drive source off.** Agents prepare and attach the curated grounding files to the Deep Research run before dispatch. Drive grounding is optional, never the default. Its connected Drive workspace supports title SEARCH only: it cannot list a folder or open a document by link. Native Google Docs do not fix this limitation.

Measured 2026-11-13/14: four runs read none of the grounding files, with both raw
Markdown and converted Docs. A Deep Research probe correctly quoted one Doc's
first line after title search, but found only 2 of 7 Docs. Plain Gemini chat could
read the same Docs by folder, title and link; that does not establish Deep Research
access. Three subsequent runs used attached files with Drive off and passed the
author-held answer key (PR 1267).

## Grounding prep — your FIRST action, before any search or draft

Done condition: no research prompt leaves this skill until ONE of these is true:
- **Project-grounded** (the default): a `/research-lifecycle` preparation receipt is
  back, naming the grounding files and the copies supplied with the run.
- **Web-only** (only when the user says the question needs no project state): the
  prompt's `# Grounding` block has the exact line `None — web-only research`
  and a separate `Reason: <the user's reason>` line. These replace the receipt.

1. Right after loading this skill, dispatch ONE sub-agent. Do not search Drive, grep
   or draft the prompt yourself first. Its brief says: "Run `/research-lifecycle`
   preparation for <project>: verify local context, refresh the Drive grounding
   corpus for provenance, prepare the bounded files for attachment with Drive off,
   and return the exact grounding file names and the lifecycle receipt."
   Pick its execution profile per `/agent-routing` § Execution capability (Drive
   write + shell); a read-only gatherer may only report staleness.
2. Web-only branch: when the user says the question needs no project state, skip
   step 1, write the exact web-only line and separate reason,
   and go straight to the emit gate below. The grounding and START/EDIT gates
   still apply.
3. Project-grounded: attach the prepared files to the run with Drive source off,
   then draft the prompt from the receipt's exact file names. While
   preparation runs or is blocked, tell Etan the prompt follows the receipt; never
   emit it before.

Include one line in the hand-off: "Grounding files are supplied with this run;
Drive source is off." Preparation is the agent's job; do not emit a prompt that
asks Etan to collect files.

### Optional Drive route — exact titles and a probe first

If Drive is used, verify every grounding document's title is unique across the
whole Drive, with no duplicate or look-alike titles. Name each document by its
exact title in the prompt, never by folder or link. Expect title search to miss
documents; a connected source and an author-side Drive read prove no researcher access.

Before the real run (for either source route), run one cheap Deep Research probe
that asks only for each named document's first line. Compare every returned line
against the author key, retaining the probe and comparison receipt outside the
researcher prompt. Any missing or mismatched line blocks the real run. For Drive,
switch to supplied files or correct the titles and repeat the probe; never fire
the real prompt on an unverified set. The probe does not replace the real run's
admission table or author-held answer key.

## Curated grounding set, admission stop, provenance

- **Curated, bounded set:** agents prepare only the files the research needs, attach them to the run, and keep a provenance copy (`/drive-filing` § Research grounding folder contract). The folder organizes the record; it is not a Deep Research access route. The prompt names the exact files and says to use ONLY them.
- **Admission table with a HARD STOP:** before firing, the prompt's `# Grounding` block carries a read-check table, one row per grounding file, with `readable: yes/no`. Project-grounded runs only; web-only research keeps its own `None — web-only research` block and has no table. Any row that is not an affirmative verified read (no, blank, missing, empty, truncated, unreadable) stops the run: output only the table and a `MISSING FILES` list. The template holds the wording.
- **Author-held answer key:** keep exact source answers and real first headings/lines in the author record's `admission-key` JSON inside `# Pre-fire checks`, never the emitted researcher text. Cover every named document and admission question. Emit refuses missing keys or verbatim answer leaks. `readable: yes` alone proves nothing: on 2026-11-13 NarrationLayer R02 with six attached grounding files invented all six answers (1.05 vs 1.5; 0.179 vs 0.484); the private key caught them. Earlier Drive-grounded runs stopped honestly with `readable: no` rows.
- **Keep the stop in the plan:** when Gemini's generated plan drops the stop, return it for EDIT and paste this sentence: `If any read-check row is not an affirmative verified read (readable: no, blank, missing, empty, truncated or unreadable), output only the read-check table and a MISSING FILES list, and stop.`
- **Provenance:** the harvest record names the model, the settings (Drive on/off, Search on/off, mode), the prompt sha256, the grounding `manifest_sha256` and the folder's link, so the run's identity survives later consolidation. Write `unknown` only for a field you could not read.

## ROUTING — Gemini Deep Research by default

- Research and comparisons → **gemini.google.com → Deep Research**. Use a structured prompt, review the generated plan, then obtain the prompt author's START / EDIT verdict.
- Quick lookups or summaries of content already in Drive → connected Drive search tools.
- **NotebookLM on request:** only for an explicit notebook, podcast/audio overview, slides or quizzes request, read [the opt-in workflows](references/notebooklm-workflows.md).

## Default workflow: Gemini Deep Research

Keep the curated provenance set in `Brain Drive/03_RESEARCH/Active/<project>/R{NN}-grounding/`; supply those files directly to the run with Drive off, using the preparation receipt's exact names. Do not use the shared `<project>/context/` corpus. Optional Drive grounding follows the exact-title and probe rules above. Number context files per `skills/golem-powers/_shared/research/context-numbering.md`.

**Prompt template:** Fill [references/prompt-template.md](references/prompt-template.md): named verified-findings + struck-claims grounding, owner asks verbatim, evidence against, DOCUMENTED / OBSERVED / CLAIMED / PROPOSED / TARGET labels, sourced measurements and two independent bias checks. Web-only research uses the template's explicit N/A branch. Do not emit an unfilled template.

Before emitting or firing, validate the author record and produce the researcher text. Exit nonzero means rewrite and rerun; a pass proves sections contain the required instruction terms and review records, not that their claims are true. Free-text sections need a phrase, not a single token:

```bash
node skills/golem-powers/gemini-research/scripts/prompt-preflight.mjs --emit /path/to/R{NN}-prompt.md > /path/to/R{NN}-research.md
```

Keep the author record locally. Paste/send only the emitted `-research.md` text
to Gemini Deep Research; it excludes the entire
author-only `# Pre-fire checks` section. Do not send reviewer identities or prep
instructions.

### EMIT-GATE — validate the prepared researcher prompt

Run `prompt-preflight.mjs --emit` above. The shared legacy
`drive-grounding-gate.sh` still checks for instructions asking Etan to collect or
supply files; it does not prove Deep Research access. Keep attachment work in
preparation, before dispatch. The researcher text describes files already supplied
with the run and names each one. A structural PASS does not prove that the files
were supplied, the probe passed, or the researcher read them: retain those receipts
and apply the admission harvest gate below.

**Interaction steps:**
1. Paste prompt → get research plan
2. **Return the generated plan to the prompt author** for an explicit
   `START` / `EDIT` verdict before firing the research. Do not click Start
   Research on your own plan interpretation.
3. **Edit the plan** if needed (add angles, remove irrelevant ones, tighten focus)
4. Click **Start Research** → wait (Fast: ~1 min, Thinking: ~5 min, Pro 3.1: 10–15 min)
5. Pass the admission harvest check below before reading the report → export to Google Doc if it needs to land in Drive
6. `brain_store` conclusions (always) + `brain_digest` raw report for entity/relation extraction (standards/deep-research-brainlayer.md). `brain_digest` was fixed in PR #100 (2026-03-22) per ~/.claude/CLAUDE.md BrainLayer Protocol; if you suspect it's returning stubbed success, fall back to `brain_store` with the full raw report as the `content` field and skip the automated extraction step.

**Admission harvest gate (project-grounded):** extract the result's admission table
without reading its report body, then run:

```bash
node skills/golem-powers/gemini-research/scripts/prompt-preflight.mjs --harvest-check /path/to/admission.md /path/to/R{NN}-prompt.md
```

The second file is the retained author record with its private key. Compare every
answer AND first-line string exactly (outer cell whitespace is trimmed). A missing,
extra, duplicate, non-yes or mismatched row fails. Retain the JSON failure receipt
as a **fabricated read**, discard the entire result, and do not read, accept, store
or relay its conclusions. A pass verifies key agreement, not report truth.

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
- Assuming a connected Drive source can browse a folder or open a link; using duplicate or look-alike titles; firing before the first-line probe passes. Attach prepared files with Drive off by default.
- Skipping the prompt-author START/EDIT gate → the research runs on the raw plan, often with blind spots you could have caught
- Leaving results unexported when they need to persist in Drive
- Using for content already in Drive — use connected Drive search tools for those lookups
