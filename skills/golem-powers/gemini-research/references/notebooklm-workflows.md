# Opt-in: only when the user asks for NotebookLM

Use only for an explicit request for a notebook, podcast/audio overview, slides or quizzes. Ordinary research uses Gemini Deep Research at gemini.google.com. Preserve the grounding preparation and prompt gates in [SKILL.md](../SKILL.md).

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

### Opt-in Drive-Sync Research

Drive is the source of truth. NotebookLM consumes the same Drive project that `/claude-desktop-research` uses.

```
1. Verify account first (expects RESEARCH_ACCOUNT, else the one in ~/.config/research-lifecycle/research.env):
   bash skills/golem-powers/_shared/research/verify-account.sh

2. Ensure Drive folders exist:
   python3 skills/golem-powers/_shared/research/drive-paths.py ensure-project-folders <project>

3. Resolve notebook state:
   ~/.golems/research-state.json maps <project> -> notebook_id
   - reuse the notebook when it already exists
   - create a new notebook when the project is new

4. Load Drive context into NotebookLM:
   - list context files from Brain Drive/03_RESEARCH/Active/<project>/context/
   - add each file into the notebook
   - for raw markdown/text files, download from Drive then upload as file sources

5. Run the prompt-preflight.mjs gate in `../SKILL.md`, then Drive-backed research:
   research_start(query=<emitted researcher text, without pre-fire checks>, source="drive", notebook_id=<id>)
   - if the tool/UI returns a research PLAN before execution, return that PLAN
     to the prompt author and wait for `START` / `EDIT` before firing
   research_status(notebook_id, task_id=<task>, max_wait=60)
   research_import(notebook_id, task_id=<task>) when sources are found

6. Query the notebook for the synthesized answer

7. Write the result to:
   Brain Drive/03_RESEARCH/Active/<project>/results/R{NN}-gemini-result.md
   (uploadFile with mimeType="text/markdown"; never content-sniffed)
```

Wrapper (live mode needs both values, and stops with an error if either is unset):

```bash
export GEMINI_RESEARCH_PROFILE=<nlm profile>   # the name you gave `nlm login --profile`
export RESEARCH_ACCOUNT=<google account>       # optional when ~/.config/research-lifecycle/research.env has RESEARCH_ACCOUNT=<address>
bash skills/golem-powers/gemini-research/scripts/drive-sync.sh --project cmux --prompt R36-R38-cmux-mobile-prompts.md
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

**Brain Drive side panel is a THIRD UI** — see the "ROUTING" section in `../SKILL.md`. It's NOT Deep Research — it's cross-file summarization against files already in Drive. Owned by `/braindrive`.

## Important Notes

- **Source limits:** 50 sources per notebook, 500K words total. Plan source selection carefully.
- **Confirm required:** Destructive operations (delete, share, studio_create) require `confirm=True`. Always ask the user before confirming.
- **Studio polling:** After `studio_create`, the artifact generates asynchronously. Poll `studio_status` — audio takes 1-3 min, video takes 3-10 min.
- **Query vs Research:** `notebook_query` asks about EXISTING sources in the notebook. `research_start` searches the WEB or DRIVE for NEW sources.
- **File types:** See "File Type Restrictions" section above for complete list and workarounds.
- **Drive doc types:** When adding Drive docs, specify `doc_type`: doc, slides, sheets, or pdf.
- **Language:** Most tools accept a `language` parameter (BCP-47 code: en, he, es, fr, de, ja).
- **Silent failures:** `source_add` may return success but sources don't persist if the MCP is connected to the wrong Google account. Always verify after upload.


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
