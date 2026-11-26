---
name: gemini-research
description: "Deep research, compare options: Gemini Deep Research. NOT for Exa web search, drive-filing or report links."
---

# Gemini Deep Research

Default: prepare a grounded prompt for Gemini Deep Research at gemini.google.com.

Triggers on: gemini research, Gemini Deep Research, deep research, compare research options.

> **Grounding default: attach files, Drive source off.** Agents prepare ONE folder holding exactly the curated grounding files with unique names. The hand-off names that folder and the files to attach; the owner attaches them when he starts the run with Drive source off. Drive grounding is optional, never the default. Its connected Drive workspace supports title SEARCH only: it cannot list a folder or open a document by link. Native Google Docs do not fix this limitation.

Measured 2026-11-13/14: four runs read none of the grounding files, with both raw
Markdown and converted Docs. A Deep Research probe correctly quoted one Doc's
first line after title search, but found only 2 of 7 Docs. Plain Gemini chat could
read the same Docs by folder, title and link; that does not establish Deep Research
access. Three subsequent runs used attached files with Drive off and passed the
author-held answer key (PR 1267).

Measured 2026-11-26, qa-video R01: the hand-off named 5 `.md` files to attach with
Drive off but carried no probe. Gemini's first answer was the admission table with
all 5 files `readable: no` plus MISSING FILES. Etan re-attached the same 5 files in
the same chat (they showed as TXT chips) with "now?", and Gemini then produced its
plan. Whether the files were attached to the first message is unknown. Harvest
check: pending. The owner hand-off block below exists because of this run.

## Grounding prep — your FIRST action, before any search or draft

Done condition: no research prompt leaves this skill until ONE of these is true:
- **Project-grounded** (the default): a `/research-lifecycle` preparation receipt is
  back, naming ONE prepared folder and exactly the curated grounding files in it, with unique names.
- **Web-only** (only when the user says the question needs no project state): the
  prompt's `# Grounding` block has the exact line `None — web-only research`
  and a separate `Reason: <the user's reason>` line. These replace the receipt.

1. Right after loading this skill, dispatch ONE sub-agent. Do not search Drive, grep
   or draft the prompt yourself first. Its brief says: "Run `/research-lifecycle`
   preparation for <project>: verify local context, refresh the Drive grounding
   corpus for provenance, prepare ONE folder holding exactly the curated grounding
   files with unique names, and return that folder, the exact file names to attach
   with Drive off, and the lifecycle receipt."
   Pick its execution profile per `/agent-routing` § Execution capability (Drive
   write + shell); a read-only gatherer may only report staleness.
2. Web-only branch: when the user says the question needs no project state, skip
   step 1, write the exact web-only line and separate reason,
   and go straight to the emit gate below. The grounding and START/EDIT gates
   still apply.
3. Project-grounded: emit the owner hand-off block below, filled in; the owner
   attaches the files when he starts the run with Drive source off.
   Draft the prompt from the receipt's exact file names. While
   preparation runs or is blocked, tell Etan the prompt follows the receipt; never
   emit it before.

Preparation is the agent's job; do not emit a prompt that asks Etan to collect files.

## Owner hand-off block — emit it, filled in, in this order

Every project-grounded hand-off IS this block. Etan fires every step (fire = Etan);
you write the probe text and you judge GO. Fill every `<...>`; keep the order and wording.

```text
Prepared folder: <absolute folder path>
Files to attach (<N>): <exact file name 1>, <exact file name 2>, ...
1. Open a NEW Gemini Deep Research chat. Turn the Drive source OFF.
2. Attach the <N> files above FIRST. Wait until all <N> file chips show. Type nothing yet.
3. Paste this probe and send it:
   <probe text, below>
4. Send the probe's answer back to <author seat>. Paste nothing else in this chat yet.
5. Only after <author seat> replies GO: paste <path to R{NN}-research.md> in the SAME chat.
6. Send Gemini's generated plan back to <author seat> for START / EDIT. Do not click Start Research yourself.
If <author seat> replies NO-GO, or a later read-check row says a file is not readable:
- Do not paste the prompt in that chat (if it was pasted, that run is discarded).
- Open a NEW chat, Drive OFF, attach the same files first, wait for every chip, and send the probe again.
- If they fail again, <author seat> sends a NEW hand-off block (.txt files, new prompt path); follow that one.
```

Probe text (one per hand-off, naming every file; never put the key's lines in it):

```text
Before anything else: for each attached file below, reply only with a table
`file | first line`, copying the file's exact first line character for character.
If you cannot open a file, write UNREADABLE in its row. Do not research, summarise or plan.
- <exact file name 1>
- <exact file name 2>
```

**GO rule:** compare each returned first line with that file's `first_line` in the
private `admission-key` (exact string, outer whitespace trimmed). GO only when every
named file has exactly one row and every line matches. Any UNREADABLE, missing,
extra or mismatched row is NO-GO. Keep the probe answer and your comparison as the
probe receipt, outside the researcher prompt. The probe does not replace the real
run's admission table or the harvest check.

**Recovery (probe or admission row not readable):**
1. Do not paste the researcher prompt in that chat; if it was already pasted, discard that run unread.
2. Send a fresh hand-off block: a NEW chat, the same files attached first, the probe again. Never retry inside the failed chat.
3. If the `.md` files fail again, YOU (the author) re-prepare; the owner never renames anything. Replace each `.md` in the prepared folder with a `.txt` copy of the same content and unique stem (`R01-01-<name>.md` → `R01-01-<name>.txt`). Then update every exact name to the `.txt` name: the `# Grounding` list and admission-question table, the private `admission-key` `document` fields, and the manifest. Re-run `prompt-preflight.mjs --emit --attached <prepared folder>` (it fails until folder, grounding and key name the same files), and send a new hand-off block with the `.txt` names, the new probe and the new prompt path.
4. A run whose files became readable only after a re-attach (same chat or new) counts only if its admission table later passes `--harvest-check` against the private key. Otherwise it is a fabricated read: discard it.

**Web-only research has no files:** its hand-off has no attach, probe or GO steps. Open a new
Deep Research chat, paste the emitted prompt, and send the plan back for START / EDIT.

### Optional Drive route — exact titles and a probe first

If Drive is used, verify every grounding document's title is unique across the
whole Drive, with no duplicate or look-alike titles. Name each document by its
exact title in the prompt, never by folder or link. Expect title search to miss
documents; a connected source and an author-side Drive read prove no researcher access.

The Drive route has its own short hand-off; nothing is attached:

```text
Drive titles (<N>, each unique across the whole Drive): "<exact title 1>", "<exact title 2>", ...
1. Open a NEW Gemini Deep Research chat. Turn the Drive source ON. Attach nothing.
2. Paste this probe and send it:
   Before anything else: search Drive for each exact title below and reply only with a table
   `title | first line`, copying the document's exact first line character for character.
   If you cannot find or open a document, write NOT FOUND in its row. Do not research, summarise or plan.
   - "<exact title 1>"
   - "<exact title 2>"
3. Send the probe's answer back to <author seat>. Paste nothing else in this chat yet.
4. Only after <author seat> replies GO: paste <path to R{NN}-research.md> in the SAME chat.
5. Send Gemini's generated plan back to <author seat> for START / EDIT. Do not click Start Research yourself.
If <author seat> replies NO-GO: do not paste the prompt. <author seat> either fixes the titles and sends a
new Drive hand-off, or switches to the attach route and sends the owner hand-off block above.
```

GO uses the same rule against the author key. On NO-GO, YOU fix duplicate or look-alike
titles, or switch to the attach route (re-emit with the attach-route grounding and
`--attached`); never fire the real prompt on an unverified set.

## Curated grounding set, admission stop, provenance

- **Curated, bounded set:** agents prepare ONE folder holding exactly the curated grounding files with unique names, name that folder and the files to attach in the hand-off, and keep a provenance copy. The owner attaches the prepared set when starting the run with Drive source off (`/drive-filing` § Research grounding folder contract). The folder organizes the record; it is not a Deep Research access route. The prompt names the exact files and says to use ONLY them.
- **Admission table with a HARD STOP:** before firing, the prompt's `# Grounding` block carries a read-check table, one row per grounding file, with `readable: yes/no`. Project-grounded runs only; web-only research keeps its own `None — web-only research` block and has no table. Any row that is not an affirmative verified read (no, blank, missing, empty, truncated, unreadable) stops the run: output only the table and a `MISSING FILES` list. The template holds the wording.
- **Author-held answer key:** keep exact source answers and real first headings/lines in the author record's `admission-key` JSON inside `# Pre-fire checks`, never the emitted researcher text. Cover every named document and admission question. Emit refuses missing keys or verbatim answer leaks. `readable: yes` alone proves nothing: on 2026-11-13 NarrationLayer R02 with six attached grounding files invented all six answers (1.05 vs 1.5; 0.179 vs 0.484); the private key caught them. Earlier Drive-grounded runs stopped honestly with `readable: no` rows.
- **Keep the stop in the plan:** when Gemini's generated plan drops the stop, return it for EDIT and paste this sentence: `If any read-check row is not an affirmative verified read (readable: no, blank, missing, empty, truncated or unreadable), output only the read-check table and a MISSING FILES list, and stop.`
- **Provenance:** the harvest record names the model, the settings (Drive on/off, Search on/off, mode), the prompt sha256, the grounding `manifest_sha256` and the folder's link, so the run's identity survives later consolidation. Write `unknown` only for a field you could not read.

## ROUTING — Gemini Deep Research by default

- Research and comparisons → **gemini.google.com → Deep Research**. Use a structured prompt, review the generated plan, then obtain the prompt author's START / EDIT verdict.
- Quick lookups or summaries of content already in Drive → connected Drive search tools.
- **NotebookLM on request:** only for an explicit notebook, podcast/audio overview, slides or quizzes request, read [the opt-in workflows](references/notebooklm-workflows.md).

## Default workflow: Gemini Deep Research

Keep the curated provenance set in `Brain Drive/03_RESEARCH/Active/<project>/R{NN}-grounding/`; name the prepared folder and its exact file names in the hand-off so the owner attaches that set when starting the run with Drive off. Do not use the shared `<project>/context/` corpus. Optional Drive grounding follows the exact-title and probe rules above. Number context files per `skills/golem-powers/_shared/research/context-numbering.md`.

**Prompt template:** Fill [references/prompt-template.md](references/prompt-template.md): named verified-findings + struck-claims grounding, owner asks verbatim, evidence against, DOCUMENTED / OBSERVED / CLAIMED / PROPOSED / TARGET labels, sourced measurements and two independent bias checks. Web-only research uses the template's explicit N/A branch. Do not emit an unfilled template.

Before emitting or firing, validate the author record and produce the researcher text. Exit nonzero means rewrite and rerun; a pass proves sections contain the required instruction terms and review records, not that their claims are true. Free-text sections need a phrase, not a single token:

```bash
node skills/golem-powers/gemini-research/scripts/prompt-preflight.mjs --emit --attached /path/to/R{NN}-grounding /path/to/R{NN}-prompt.md > /path/to/R{NN}-research.md
```

`--attached <prepared folder>` (attach route) also fails unless the folder's files
(hidden files and `00-GROUNDING-MANIFEST.md` excluded) are exactly the documents the
`# Grounding` list names, so a renamed file can't leave the prompt or key naming the old one.
Omit it only for the Drive or web-only route.

Keep the author record locally. Paste/send only the emitted `-research.md` text
to Gemini Deep Research; it excludes the entire
author-only `# Pre-fire checks` section. Do not send reviewer identities or prep
instructions.

### EMIT-GATE — validate the prepared researcher prompt

Run `prompt-preflight.mjs --emit` above. The shared legacy
`drive-grounding-gate.sh` still checks for instructions asking Etan to collect or
supply files; it does not prove Deep Research access. Keep file collection in
agent preparation; the owner attaches the named prepared set when starting the run. The researcher text describes files already supplied
with the run and names each one. A structural PASS does not prove that the files
were supplied, the probe passed, or the researcher read them: retain those receipts
and apply the admission harvest gate below.

**Interaction steps:**
1. Etan runs the owner hand-off block (new chat, attach first, probe, GO), then pastes the prompt → research plan
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
- Assuming a connected Drive source can browse a folder or open a link; using duplicate or look-alike titles; firing before the first-line probe passes. Prepare one folder and name its files in the hand-off; the owner attaches that set with Drive off by default.
- Skipping the prompt-author START/EDIT gate → the research runs on the raw plan, often with blind spots you could have caught
- Leaving results unexported when they need to persist in Drive
- Using for content already in Drive — use connected Drive search tools for those lookups
