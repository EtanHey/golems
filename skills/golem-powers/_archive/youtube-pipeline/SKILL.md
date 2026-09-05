---
name: youtube-pipeline
description: Extract knowledge from YouTube videos into BrainLayer. Use when user shares a YouTube link or asks to process/watch/extract from a video. Chains exa (transcript) -> brain_digest (entities/relations) -> brain_store (conclusions). Works with any YouTube URL.
---

# YouTube Pipeline

Extract knowledge from YouTube videos and store permanently in BrainLayer.

## Pipeline

```
YouTube URL
    ↓
1. exa web_search (full URL as query)
    → title, transcript, metadata
    ↓
2. brain_digest (raw transcript + metadata)
    → entities, relations, action items, decisions
    ↓
3. brain_store (structured conclusions)
    → searchable knowledge forever
```

## Usage

When user shares a YouTube link:

### Step 1: Extract via Exa

```
web_search_exa(query: "https://youtube.com/watch?v=VIDEO_ID", num_results: 1)
```

Exa returns: title, URL, full transcript text, publish date, author.

**IMPORTANT:** `WebFetch` does NOT work for YouTube. Always use exa.

### Step 2: Digest raw content

```
brain_digest(content: "<title>\n<author>\n<date>\n\n<full transcript text>")
```

This extracts: entities (people, tools, companies), relations, sentiment, action items, decisions, questions. Creates a searchable chunk with `source='digest'`.

### Step 3: Store conclusions

```
brain_store(
  content: "Video: '<title>' by <author> (<date>)\nURL: <url>\n\nKey findings:\n1. ...\n2. ...\n3. ...\n\nAction items:\n- ...\n\nRelevant to: <projects>",
  tags: ["youtube", "<author-slug>", "<topic-tags>"],
  importance: 6-8
)
```

### Step 4: Report to user

Summarize:
- Video title and author
- Top 3-5 key takeaways
- Action items (things to build/try/investigate)
- How it connects to current projects
- BrainLayer chunk IDs for future reference

## Batch Mode

For multiple videos (e.g., a playlist or "process these 5 videos"):

1. Run exa searches in parallel (up to 5 concurrent)
2. Digest each transcript
3. Store individual conclusions + one synthesis
4. Report all findings in a single summary

## Tag Convention

| Tag | When |
|-----|------|
| `youtube` | Always |
| `<author-slug>` | e.g., `theo-browne`, `matt-pocock`, `primeagen` |
| `<topic>` | e.g., `ai-agents`, `typescript`, `rust`, `career` |
| `<project>` | If directly relevant: `golem-terminal`, `voicelayer`, etc. |

## Tips

- Exa sometimes returns partial transcripts for very long videos (3h+). Note this in the summary.
- For livestreams/podcasts, extract the segments that matter — don't store 3 hours of chat.
- If exa returns no transcript, try `web_search_exa("<video title> transcript")` as fallback.
- Cross-reference findings with existing BrainLayer knowledge: `brain_search("<key topic>")` before storing to avoid duplicates.
