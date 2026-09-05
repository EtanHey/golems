# Find LinkedIn Topics

Find good post topics from your actual work. Scans git history, identifies interesting patterns, and suggests angles optimized for LinkedIn engagement.

## Steps

### 1. Scan Recent Work

```bash
# Last 2 weeks of commits across key repos
cd ~/Gits/golems && git log --oneline --since="2 weeks ago" --all
cd ~/Gits/etanheyman.com && git log --oneline --since="2 weeks ago" --all 2>/dev/null
```

### 2. Identify Interesting Patterns

Look for commits that tell a story:
- **"Built X from scratch"** — new features, new tools
- **"Solved hard problem Y"** — debugging stories, architecture decisions
- **"Our approach to Z"** — methodology, workflow, philosophy
- **"Automated X"** — efficiency gains with numbers
- **"Migrated from A to B"** — technology transitions with reasoning

### 3. Cross-Reference with LinkedIn Algorithm

For each potential topic, evaluate:
- **Save-worthy?** Would someone bookmark this? (guides, checklists, frameworks)
- **Personal story?** Can you add "here's what I learned" angle?
- **Contrarian take?** Does it challenge conventional wisdom?
- **Numbers?** Can you include specific metrics?
- **Timely?** Does it connect to current trends (AI, job market, etc.)?

### 4. Output Format

Present 3-5 topic suggestions:

```
## Topic Suggestions

### 1. [Title — catchy, specific]
- **Angle:** [underdog story / practical guide / contrarian take / behind-the-scenes]
- **Hook idea:** [the 3-line opener that stops scrolling]
- **Why it works:** [which LinkedIn rules it hits: save-worthy, personal, etc.]
- **Format:** [text post / numbered list / carousel]
- **Language:** [English for global / Hebrew for Israeli tech]

### 2. [Title]
...
```

### 5. Topic Selection

After presenting topics, ask:
- "Which topic resonates? I'll draft it with `/linkedin-post draft`"
- Suggest the one most likely to get saves (Rule 7)

## Example Topics (from Etan's work)

- "I automated my job search with 6 AI agents - here's what actually worked"
- "238 jobs from 12 companies, zero API keys needed (free ATS scraping)"
- "Why I built a memory system for my AI coding assistant"
- "The feedback loop that makes AI job matching actually useful"
- "5 things I learned building autonomous AI agents for 6 months"
