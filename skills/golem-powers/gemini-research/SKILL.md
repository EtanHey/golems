---
name: gemini-research
description: "NotebookLM/Gemini research: sources, Deep Research, queries, artifacts. Triggers: Gemini, synthesis."
---

# Gemini Deep Research — MCP-Native Workflow

Create notebooks, add sources, run research, query content, and generate artifacts using the NotebookLM MCP server (`mcp__notebooklm-mcp__*`). This is a direct API approach — no browser automation needed.

Triggers on: gemini research, Gemini Deep Research, NotebookLM, notebook research, add sources to notebook, generate podcast, create audio overview, study materials, slides, quizzes, and source-grounded reports.

> **🔑 DRIVE-WORKSPACE RULE (Etan, standing — never violate):** Etan's Gemini has his Google Drive workspace CONNECTED. Every deep-research prompt must REFERENCE the relevant Google Doc(s) by NAME (e.g. *"ground this in my 'Context Strategy' doc in my Drive"*) so Gemini pulls them itself via the Drive connector. **NEVER instruct Etan to attach/upload files** — he should never have to attach anything. Reference doc names, not attachments.

## ROUTING — Three Gemini/NotebookLM UIs (READ FIRST)

**This skill owns TWO of three distinct Gemini research UIs.** Picking the wrong one silently burns a session — they look similar but have incompatible prompting styles.

| UI | Access | Use when | Prompt style | Skill |
|---|---|---|---|---|
| **Brain Drive side-panel Gemini** | drive.google.com → "Ask Gemini" button | Quick lookups across files ALREADY in Drive, session mining, folder summaries | **Short** (3–8 lines), `@filename` / `@folder` syntax, one question at a time, sequential chains | **/braindrive** |
| **Gemini Deep Research** (standalone UI) | gemini.google.com → "Deep Research" mode | Broad WEB research, one-shot comprehensive synthesis, plan-review editable before execution | **Long structured prompts fine** (1000+ words). Plan-review → Edit → Start Research. Model tier: Fast / Thinking / Pro 3.1. Drive connector. | **/gemini-research** (§ below) |
| **NotebookLM Deep Research** | notebooklm.google.com OR `mcp__notebooklm-mcp__*` | Persistent notebook with curated sources, repeat queries, artifacts (audio / slides / quizzes / reports) | API-first via MCP. `notebook_create` + `source_add` + `research_start(mode="deep")`. Best when revisiting same sources. | **/gemini-research** (default workflow) |

**Decision tree:**
- Content is ALREADY in Drive → **Brain Drive side panel** (`/braindrive`)
- Need broad WEB research, one-shot → **gemini.google.com Deep Research** (see "Gemini Deep Research (Standalone UI)" section below)
- Need persistent notebook + artifacts → **NotebookLM MCP** (rest of this skill)

**Anti-patterns observed (2026-04-11):** a 1800-word structured prompt wasted on the side panel (truncated); a 5-line short prompt wasted on gemini.google.com Deep Research (missed context); NotebookLM MCP setup run for a task that only needed a 3-line side-panel query. Match the prompt length and setup cost to the UI.

## Gemini Deep Research (Standalone UI at gemini.google.com)

**Separate from NotebookLM.** Distinct interaction model. Use this when you need broad WEB research with source gathering and a plan-review flow BEFORE the research runs.

| Feature | Details |
|---|---|
| **Access** | gemini.google.com → model picker → "Deep Research" mode |
| **Model tier** | Fast (fewest sources, minutes) / Thinking (deeper, ~5 min) / Pro 3.1 (most comprehensive, 10–15 min) |
| **Prompt style** | **Long structured prompts encouraged.** 1000+ words with sections, constraints, and desired output format all work. The research planner reads the whole thing. |
| **Flow** | Paste prompt → Gemini produces a research PLAN → **review + Edit the plan** → **Start Research** → wait → read report |
| **Drive connector** | Etan's Drive workspace is **already connected**. The prompt must REFERENCE the grounding doc(s) by NAME (Gemini pulls them itself). NEVER tell Etan to attach/upload — see the DRIVE-WORKSPACE RULE at the top and the emit-gate below. |
| **Output** | Long-form report with inline citations. Exportable to Google Doc. |

**When to use gemini.google.com Deep Research vs NotebookLM:**
- **gemini.google.com** → one-shot broad web research, won't revisit, want the plan-review step, want to edit the research plan before it runs
- **NotebookLM** → persistent notebook, curated sources, repeat queries, generate artifacts (audio overview, slides, quizzes, etc.)

**Prompt template for gemini.google.com Deep Research:**
```
# Research goal
<one-sentence what you need to learn>

# Grounding (Drive workspace — CONNECTED; REQUIRED block)
Ground this research in the following docs from my Google Drive — pull them
yourself via the connected Drive workspace; do NOT ask me to attach anything:
- "<Exact Google Doc name 1>"
- "<Exact Google Doc name 2>"
<If no Drive doc applies, write "None — web-only research" so the omission is
deliberate, not an oversight. Never replace this block with an attach/upload ask.>

# Scope
<what TO include — specific domains, timeframes, primary vs secondary sources>

# Anti-scope
<what NOT to include — common tangents, outdated info, marketing content>

# Evaluation criteria
<how I'll judge the findings — what makes a good source, what's disqualifying>

# Prior art I already have
<optional: what BrainLayer / local context already says so the research doesn't re-cover it>

# Desired output
<structure: executive summary, N findings, confidence level, sources, etc.>
```

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
| `harvest_trigger` | `research_status complete` / Drive export lands / Etan says done |
| `export_route` | `Drive/Research/<project>/results/R{NN}-gemini-result.md` → brain_store |

Includes researches **Etan fires himself** in gemini.google.com or NotebookLM UI
(fire=Etan standing rule) — adapters name who harvests and where results export back
to the fleet. Research without a harvest path = **parked**, not done.

**Anti-patterns:**
- **Telling Etan to attach/upload a doc** — his Drive workspace is CONNECTED; the prompt must reference the doc by NAME so Gemini pulls it itself. This is gate-enforced (`drive-grounding-gate.sh`) — a prompt with attach/upload language does not get emitted.
- Skipping the prompt-author START/EDIT gate → the research runs on the raw plan, often with blind spots you could have caught
- Treating this like NotebookLM — it's NOT a persistent notebook, the research run is ephemeral unless you export
- Using for content already in Drive — that's /braindrive territory, cheaper and faster
- Using `gemini.google.com` for a task that will need multiple follow-up queries on the same sources — use NotebookLM instead

## Quick Reference

| Task | Tool | Key Args |
|------|------|----------|
| Create notebook | `notebook_create` | `title` |
| Add URL/YouTube | `source_add` | `source_type="url"`, `url=` or `urls=[]` |
| Add local file | `source_add` | `source_type="file"`, `file_path=` |
| Add text | `source_add` | `source_type="text"`, `text=`, `title=` |
| Add Drive doc | `source_add` | `source_type="drive"`, `document_id=`, `doc_type=` |
| Query notebook | `notebook_query` | `notebook_id`, `query` |
| Deep research | `research_start` | `query`, `mode="deep"`, `source="web"` |
| Fast research | `research_start` | `query`, `mode="fast"`, `source="web"` |
| Drive search | `research_start` | `query`, `source="drive"` |
| Create podcast | `studio_create` | `artifact_type="audio"`, `confirm=True` |
| Create slides | `studio_create` | `artifact_type="slide_deck"`, `confirm=True` |
| Create report | `studio_create` | `artifact_type="report"`, `confirm=True` |
| Download artifact | `download_artifact` | `artifact_type=`, `output_path=` |
| Set chat instructions | `chat_configure` | `goal="custom"`, `custom_prompt=` |

## Auth

If you get authentication errors, run `nlm login` via Bash first — this is the automated method. Only use `save_auth_tokens` as a fallback if the CLI fails. To switch Google accounts: `nlm login switch <profile>`.

## Core Workflows

### Default Workflow: Drive-Sync Research

Drive is the source of truth. NotebookLM consumes the same Drive project that `/claude-desktop-research` uses.

```
1. Verify account first:
   bash skills/golem-powers/_shared/research/verify-account.sh --expect research-account@example.com

2. Ensure Drive folders exist:
   python3 skills/golem-powers/_shared/research/drive-paths.py ensure-project-folders <project>

3. Resolve notebook state:
   ~/.golems/research-state.json maps <project> -> notebook_id
   - reuse the notebook when it already exists
   - create a new notebook when the project is new

4. Load Drive context into NotebookLM:
   - list context files from Drive/Research/<project>/context/
   - add each file into the notebook
   - for raw markdown/text files, download from Drive then upload as file sources

5. Run Drive-backed research:
   research_start(query=<prompt from Drive/prompts/>, source="drive", notebook_id=<id>)
   - if the tool/UI returns a research PLAN before execution, return that PLAN
     to the prompt author and wait for `START` / `EDIT` before firing
   research_status(notebook_id, task_id=<task>, max_wait=60)
   research_import(notebook_id, task_id=<task>) when sources are found

6. Query the notebook for the synthesized answer

7. Write the result to:
   Drive/Research/<project>/results/R{NN}-gemini-result.md
```

Wrapper:

```bash
bash skills/golem-powers/gemini-research/scripts/drive-sync.sh --project cmux --prompt R36-R38-cmux-mobile-prompts.md
```

### 1. Create a Research Notebook

Create a notebook, add sources, and configure it for a research topic:

```
1. notebook_create(title="Research: [Topic]")
   → Save the notebook_id

2. Add sources (can do multiple in sequence):
   - source_add(notebook_id, source_type="url", url="https://...", wait=True)
   - source_add(notebook_id, source_type="file", file_path="/path/to/doc.pdf", wait=True)
   - source_add(notebook_id, source_type="text", text="...", title="Context Notes")
   
   Use wait=True so sources are processed before querying.
   For bulk URLs: source_add(notebook_id, source_type="url", urls=["url1", "url2", ...])

3. Configure chat behavior:
   chat_configure(notebook_id, goal="custom", 
     custom_prompt="You are a research assistant focused on [topic]. 
     Prioritize primary sources and cite specific findings.")

4. Query the notebook:
   notebook_query(notebook_id, query="What are the key findings about [topic]?")
```

**Use `wait=True` on source_add** — without it, the source may not be indexed when you query. Default timeout is 120s.

### 2. Run Deep Research

Deep Research searches the web for new sources and imports them into your notebook:

```
1. research_start(
     query="[your research question]",
     mode="deep",           # ~5 min, ~40 sources (or "fast" for ~30s, ~10 sources)
     source="web",          # or "drive" for Google Drive search
     notebook_id=notebook_id  # add to existing notebook (or omit to create new)
   )
   → Save the task_id

2. Poll for completion:
   research_status(notebook_id, task_id=task_id, max_wait=300)
   
   This blocks until complete or timeout. For deep research, set max_wait=600.

3. Import discovered sources:
   research_import(notebook_id, task_id=task_id)
   
   Or import specific sources by index:
   research_import(notebook_id, task_id=task_id, source_indices=[0, 2, 5])
```

**Deep vs Fast:**
- `deep` — ~5 minutes, finds ~40 sources, web only. Best for comprehensive research.
- `fast` — ~30 seconds, finds ~10 sources, supports web and drive. Good for quick lookups.

### 3. Generate Artifacts

NotebookLM can create rich artifacts from your notebook's sources:

```
# Audio podcast (the famous "Audio Overview")
studio_create(notebook_id, artifact_type="audio", confirm=True)
  Options: audio_format="deep_dive"|"brief"|"critique"|"debate"
           audio_length="short"|"default"|"long"

# Slide deck
studio_create(notebook_id, artifact_type="slide_deck", confirm=True)
  Options: slide_format="detailed_deck"|"presenter_slides"

# Report
studio_create(notebook_id, artifact_type="report", confirm=True)
  Options: report_format="Briefing Doc"|"Study Guide"|"Blog Post"|"Create Your Own"
           custom_prompt="Focus on..." (when using Create Your Own)

# Quiz
studio_create(notebook_id, artifact_type="quiz", question_count=10, confirm=True)
  Options: difficulty="easy"|"medium"|"hard"

# Other: video, infographic, mind_map, flashcards, data_table
```

**After creating:** Poll `studio_status(notebook_id)` until complete. Then download:
```
download_artifact(notebook_id, artifact_type="audio", output_path="podcast.mp3")
download_artifact(notebook_id, artifact_type="slide_deck", output_path="slides.pptx", slide_deck_format="pptx")
download_artifact(notebook_id, artifact_type="report", output_path="report.md")
```

**Visual styles** (for video/infographic): auto_select, classic, whiteboard, kawaii, anime, watercolor, retro_print, heritage, paper_craft, sketch_note, professional, bento_grid, editorial, instructional, bricks, clay, scientific.

### 4. Manage Sources

```
# List sources with Drive freshness status
source_list_drive(notebook_id)

# Get raw text content of a source (fast, no AI processing)
source_get_content(source_id)

# Get AI summary + keywords for a source
source_describe(source_id)

# Sync stale Drive sources with latest content
source_sync_drive(source_ids=[...], confirm=True)

# Delete source (irreversible)
source_delete(source_id=source_id, confirm=True)
```

### 5. Notes (In-Notebook Working Memory)

Notes are like scratchpads within a notebook — useful for storing research findings, custom context, or instructions that the AI chat references:

```
note(notebook_id, action="create", title="Key Findings", content="...")
note(notebook_id, action="list")
note(notebook_id, action="update", note_id=id, content="Updated...")
note(notebook_id, action="delete", note_id=id, confirm=True)
```

Notes appear alongside sources in the notebook and influence query responses.

### 6. Sharing

```
# Get sharing status
notebook_share_status(notebook_id)

# Enable public link
notebook_share_public(notebook_id, is_public=True)

# Invite collaborator
notebook_share_invite(notebook_id, email="user@example.com", role="editor")

# Batch invite
notebook_share_batch(notebook_id, 
  recipients=[{"email": "a@example.com", "role": "editor"}, {"email": "c@example.com"}],
  confirm=True)
```

## Common Patterns

### Research Pipeline (end-to-end)

When the user says "research X using NotebookLM":

1. **Create:** `notebook_create(title="Research: X")`
2. **Seed:** Add any local files, URLs, or text the user provides as sources
3. **Research:** `research_start(query="X", mode="deep", notebook_id=id)`
4. **Wait:** `research_status(notebook_id, max_wait=600)`
5. **Import:** `research_import(notebook_id, task_id=task_id)`
6. **Query:** `notebook_query(notebook_id, query="Synthesize the key findings about X")`
7. **Artifact:** Generate a report or audio overview for easy consumption
8. **Download:** Save artifacts locally

### Adding Context from Local Project (the proven 96-file pattern)

The gold standard is the brainlayer-vs-lightrag project with 96 numbered context files. Use the shared numbering source of truth at `skills/golem-powers/_shared/research/context-numbering.md`.

**For the 50-source NotebookLM limit:** prioritize `00`, `01-19`, `40-49`, and `60-69` first. That keeps the notebook grounded in the code map, key source files, real data, and live examples before you spend slots on config or history.

**Auto-generation:**
```
1. Read repo structure → write 00-code-map.md
2. Read key source files → write numbered context files, renaming blocked types to .txt
3. Run Cursor with SQL queries → write 40-49 data samples
4. Run MCP tools → capture 60-69 live examples
5. source_add each file with wait=True
```

**Simple single-file method (for quick context):**
```python
content = Read("/path/to/important-doc.md")
source_add(notebook_id, source_type="text", text=content, title="Project Architecture")
```

### Batch Source Addition

For adding many URLs at once (e.g., from a research list):

```
source_add(notebook_id, source_type="url", 
  urls=["https://paper1.com", "https://paper2.com", "https://blog.com/post"],
  wait=True)
```

## Critical Gotchas (from real session failures, April 4 2026)

### Sources ≠ Prompts (NP1 — #1 mistake)

**Sources are CONTEXT. Queries are QUESTIONS.** Never upload a research prompt as a source.

- A research prompt (e.g., "Investigate BrainLayer search improvements") is a QUERY you send to `notebook_query` or `research_start`
- Context files (architecture docs, code samples, prior research) are SOURCES you upload via `source_add`
- Evidence: orcClaude uploaded R75 research prompts as NotebookLM sources. User: "Why did you upload this file? That's something you send to research on Notebook LM."

### Account Verification Before Creation (NP4)

**Check which Google account the MCP is connected to BEFORE creating notebooks.**

The MCP may be connected to a different Google account than the one with the AI Pro subscription. Evidence: notebook created on `maintainer@example.com` instead of `research-account@example.com`, causing sources to silently fail. To check: `server_info()` or `notebook_list()` — verify the account matches the intended user. To switch: `nlm login switch <profile>` (or `nlm login --clear --profile <name>` for fresh auth).

### File Type Restrictions (NP3 — complete list)

| Accepted | Blocked |
|----------|---------|
| pdf, txt, md, docx, csv, pptx, epub, images, audio/video | **.py, .json, .swift, .yaml, .ts, .js** |

**Workaround for blocked types:** Rename to `.txt` (e.g., `search.py` → `search.py.txt`) or use `source_type="text"` via MCP to paste file contents directly. Evidence: 52 code files had to be renamed during April 4 session.

### Deep Research — shared engine, different UIs (NP5 — updated 2026-04-11)

NotebookLM Deep Research and gemini.google.com Deep Research share the underlying research engine, but they are **distinct UIs with different interaction models**. The old claim "you never need to go to gemini.google.com separately" was wrong — each UI has real advantages:

| | NotebookLM Deep Research | gemini.google.com Deep Research |
|---|---|---|
| **Access** | `research_start(mode="deep")` via MCP, or notebooklm.google.com | gemini.google.com → Deep Research mode |
| **Persistence** | Runs into a persistent notebook — sources stay, can re-query | Ephemeral run, export to Drive/Doc to keep |
| **Plan review** | No plan-review step | **Plan-review → Edit → Start Research** flow |
| **Model tier** | Single mode | **Fast / Thinking / Pro 3.1** selectable |
| **Prompt style** | Shorter queries (character limit on "Search the web" bar) | Long structured prompts fine |
| **Artifacts** | Audio / slides / quiz / report generation after import | Long-form report only (export to Doc) |
| **Best for** | Repeat queries on curated sources, artifact generation | One-shot broad web research with plan-review |

- **NotebookLM Fast:** ~30s, ~10 sources (quick directional checks)
- **NotebookLM Deep:** ~5 min, ~40 sources (comprehensive, web-crawling)
- **gemini.google.com Pro 3.1:** 10–15 min (most comprehensive single run)

**Long-prompt workaround for NotebookLM:** The "Search the web" bar has character limits. Add the prompt as a `note()` in the notebook, then send a shorter query referencing it. Or use gemini.google.com Deep Research instead (no char limit).

**Brain Drive side panel is a THIRD UI** — see the "ROUTING" section at the top of this skill. It's NOT Deep Research — it's cross-file summarization against files already in Drive. Owned by `/braindrive`.

## Important Notes

- **Source limits:** 50 sources per notebook, 500K words total. Plan source selection carefully.
- **Confirm required:** Destructive operations (delete, share, studio_create) require `confirm=True`. Always ask the user before confirming.
- **Studio polling:** After `studio_create`, the artifact generates asynchronously. Poll `studio_status` — audio takes 1-3 min, video takes 3-10 min.
- **Query vs Research:** `notebook_query` asks about EXISTING sources in the notebook. `research_start` searches the WEB or DRIVE for NEW sources.
- **File types:** See "File Type Restrictions" section above for complete list and workarounds.
- **Drive doc types:** When adding Drive docs, specify `doc_type`: doc, slides, sheets, or pdf.
- **Language:** Most tools accept a `language` parameter (BCP-47 code: en, he, es, fr, de, ja).
- **Silent failures:** `source_add` may return success but sources don't persist if the MCP is connected to the wrong Google account. Always verify after upload.

## Workflows

- **`workflows/research-pipeline.md`** — Full research workflow: create → seed → research → query → artifact → download
- **`workflows/batch-sources.md`** — Add many sources efficiently (URLs, files, text)
- **`workflows/artifact-generation.md`** — Generate and download all artifact types

## References

- **`references/artifact-types.md`** — Complete artifact type reference with all options
- **`references/troubleshooting.md`** — Auth issues, timeouts, common errors
