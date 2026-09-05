# NotebookLM MCP — Troubleshooting

## Authentication

**"Authentication error" or 401/403 responses:**
1. Run `nlm login` via Bash — this is the automated method
2. If that fails, use `save_auth_tokens` with cookies from Chrome DevTools
3. To switch Google accounts: `nlm login switch <profile>`
4. After any auth change, call `refresh_auth` to pick up new tokens

**Check server status:**
```
server_info()  # Returns version, update availability
```

## Source Processing

**Source stuck in "processing" state:**
- Some sources take longer (large PDFs, long YouTube videos)
- Default `wait_timeout` is 120s — increase for large files
- YouTube transcripts can take 1-3 minutes
- If stuck permanently, delete and re-add the source

**"Source limit reached":**
- Max 50 sources per notebook, 500K words total
- Delete unused sources or create a new notebook
- Use `source_get_content` to export content before deleting

## Research

**Deep research timeout:**
- Deep research takes ~5 minutes — set `max_wait=600` on `research_status`
- If it times out, call `research_status` again with `max_wait=0` (single poll) to check current state

**"No sources found":**
- Try more specific or broader query terms
- Switch between `source="web"` and `source="drive"`
- Use `mode="fast"` first to test if query returns anything

## Studio/Artifacts

**Artifact generation stuck:**
- Poll `studio_status(notebook_id)` to check progress
- Audio: 1-3 min, Video: 3-10 min, Reports: 30s-2 min
- If stuck past 15 min, the generation likely failed — retry

**Download fails:**
- Verify artifact is complete via `studio_status`
- Check output_path is writable
- For slide_deck, specify format: `slide_deck_format="pptx"` or `"pdf"`

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Notebook not found" | Wrong notebook_id or deleted | `notebook_list()` to get valid IDs |
| "Source not found" | Wrong source_id | `notebook_get(notebook_id)` to list sources |
| "Confirm required" | Destructive op without confirm=True | Add `confirm=True` (ask user first) |
| "Rate limited" | Too many requests | Wait 30s and retry |
| "Processing" | Source not yet indexed | Use `wait=True` on `source_add` |
