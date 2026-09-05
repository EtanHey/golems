# Research Pipeline — Full End-to-End Workflow

Complete workflow for creating a notebook, adding sources, running research, querying, and generating artifacts.

## Step 1: Create the Notebook

```
notebook_create(title="Research: [Topic Name]")
→ notebook_id (save this — needed for all subsequent calls)
```

## Step 2: Seed with Existing Sources

Add any sources the user already has. Use `wait=True` to ensure indexing completes.

**URLs (including YouTube):**
```
source_add(notebook_id, source_type="url", url="https://example.com/paper", wait=True)
```

**Bulk URLs:**
```
source_add(notebook_id, source_type="url", 
  urls=["https://paper1.com", "https://paper2.com"], wait=True)
```

**Local files:**
```
source_add(notebook_id, source_type="file", file_path="/path/to/document.pdf", wait=True)
```

**Text content (from Read tool, or pasted):**
```
source_add(notebook_id, source_type="text", 
  text="[content from local file]", title="Project Context", wait=True)
```

**Google Drive:**
```
source_add(notebook_id, source_type="drive", document_id="[drive-doc-id]", doc_type="doc")
```

## Step 3: Configure Chat Behavior (optional)

Set a custom system prompt for the notebook's AI:

```
chat_configure(notebook_id, goal="custom",
  custom_prompt="You are a research assistant analyzing [topic]. Focus on:
  1. Primary source evidence
  2. Contradictions between sources
  3. Gaps in the literature
  Always cite specific sources by name.")
```

## Step 4: Run Deep Research

Search the web for additional sources:

```
result = research_start(
  query="[specific research question]",
  mode="deep",        # "deep" = ~5 min, ~40 sources | "fast" = ~30s, ~10 sources
  source="web",       # "web" or "drive"
  notebook_id=notebook_id
)
task_id = result.task_id
```

Poll until complete:
```
status = research_status(notebook_id, task_id=task_id, max_wait=600)
```

Import all discovered sources (or specific ones):
```
research_import(notebook_id, task_id=task_id)
# Or selective: research_import(notebook_id, task_id=task_id, source_indices=[0, 3, 7])
```

## Step 5: Query the Notebook

Ask questions about all the collected sources:

```
notebook_query(notebook_id, query="What are the key findings about [topic]?")
notebook_query(notebook_id, query="What contradictions exist between sources?")
notebook_query(notebook_id, query="Summarize the evidence for [specific claim]")
```

For follow-up questions in the same conversation:
```
result = notebook_query(notebook_id, query="First question")
conversation_id = result.conversation_id
notebook_query(notebook_id, query="Follow up on that", conversation_id=conversation_id)
```

## Step 6: Generate Artifacts

Create a report or audio overview for easy consumption:

```
# Briefing document
studio_create(notebook_id, artifact_type="report", 
  report_format="Briefing Doc", confirm=True)

# Audio podcast
studio_create(notebook_id, artifact_type="audio",
  audio_format="deep_dive", audio_length="default", confirm=True)

# Study materials
studio_create(notebook_id, artifact_type="flashcards", difficulty="medium", confirm=True)
studio_create(notebook_id, artifact_type="quiz", question_count=10, confirm=True)
```

Poll for completion:
```
studio_status(notebook_id)  # Check all artifacts
```

## Step 7: Download Results

```
download_artifact(notebook_id, artifact_type="report", output_path="research-report.md")
download_artifact(notebook_id, artifact_type="audio", output_path="research-podcast.mp3")
download_artifact(notebook_id, artifact_type="slide_deck", output_path="slides.pptx", slide_deck_format="pptx")
```

Or export to Google Docs/Sheets:
```
export_artifact(notebook_id, artifact_id="[artifact-uuid]", export_type="docs", title="Research Report")
```

## Step 8: Store Results in BrainLayer (if available)

If BrainLayer MCP is connected, store key findings:
```
brain_store(content="NotebookLM research on [topic]: [key findings]", 
  tags=["research", "notebooklm", "[topic]"], importance=7)
```
