# Draft Workflow

Generate a draft post for the content pipeline.

## Usage

```
/content draft <type> "<topic>"
```

**Types:**
- `teaser` - 2-3 sentence hook for tomorrow's reveal
- `reveal` - Full deep-dive post
- `author` - Human perspective note
- `quick` - Short stat/humor post

## Instructions

Based on the type and topic, generate a draft following the voice guides in SKILL.md.

### For Teasers
- Max 2-3 sentences
- End with "Tomorrow:" or similar hook
- Be mysterious but not clickbait

### For Reveals
- Use markdown formatting (##, **, ```, ---)
- One feature only, go deep
- Include code blocks or ASCII where relevant
- End with thought-provoking question

### For Author Notes
- Start with "Author note:" or similar
- 3-5 sentences max
- Behind-the-scenes perspective
- Sign off with "- Etan"

### For Quick Hits
- 1-3 sentences
- Stats, timestamps, or humor
- Can be self-deprecating

## Output Format

```markdown
---
type: <type>
voice: claudegolem|author
series: <series-name>
platform: soltome
scheduled: <suggested-date>
---

<title>

<content>
```

## After Drafting

Save to `~/Gits/golems-zikaron/data/drafts.json` and notify via Telegram.
