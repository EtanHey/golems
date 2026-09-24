# NotebookLM Workflows and Common Patterns

> Moved out of `../SKILL.md` (GO-3 PR-7): notebook create, Deep Research, artifacts, sources, notes,
> sharing, and the end-to-end / local-context / batch patterns. SKILL.md keeps routing, the emit gate,
> auth, the default Drive-sync workflow and the gotchas.

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
