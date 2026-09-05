# Claude Chat Project Files

These files are designed to be uploaded to **claude.ai projects** to give Claude domain-specific context for each golem.

## Setup

1. Go to [claude.ai](https://claude.ai) → Projects → Create Project
2. Name it after the golem (e.g., "RecruiterGolem")
3. Upload the golem's instruction file + `style-card.md`
4. Start chatting with golem-specific context

## Files

| File | Upload To | Purpose |
|------|-----------|---------|
| `recruiter-golem.md` | RecruiterGolem project | Job search, outreach, interviews |
| `claude-golem.md` | ClaudeGolem project | General assistant, routing, coordination |
| `style-card.md` | All projects | Owner's communication style (from Zikaron) |

## Updating

When these files change (after `git pull` or `golems update`):

```bash
# Regenerate instruction files from templates:
golems instructions

# Or check what changed:
git diff contexts/claude-chat/
```

Re-upload any changed files to your claude.ai projects.

## Generating Your Own Style Card

If you have Zikaron set up with your own conversation data:

```bash
# From packages/autonomous/:
bun run src/lib/style-export.ts

# Or from anywhere:
golems regen-style
```

This reads `~/.golems-zikaron/style/semantic-style-data.json` and regenerates `style-card.md` with your personal communication patterns.
