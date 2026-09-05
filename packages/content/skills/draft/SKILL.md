---
name: draft
description: Draft content for Soltome, LinkedIn, or blog using the critique-waves pattern (generate → critique → refine → polish).
---

# Content Drafting

Draft content using the critique-waves pipeline.

**Arguments**: $ARGUMENTS — topic or platform (soltome | LinkedIn | blog)

## Pipeline

1. **Topic selection**: Use provided topic, or discover from recent code commits / conversations
2. **First draft**: Generate initial draft matching the owner's writing voice
3. **Critique wave**: Parallel agents critique for: clarity, engagement, technical accuracy, voice match
4. **Refinement**: Address critique feedback, tighten language
5. **Polish**: Final pass for tone, hook strength, and platform-specific formatting
6. **Output**: Present final draft for approval

## Voice Guidelines

- Casual, collaborative researcher tone
- Technical depth without unnecessary jargon
- Hebrew ↔ English code-switching where natural
- See `~/.claude/learnings/hebrew-tech-ghostwriting.md` for full guidelines

## Platform-Specific

- **Soltome**: 2 credits per post, focus on AI/agents community
- **LinkedIn**: 2026 algorithm rules (see linkedin-post skill)
- **Blog**: Long-form, can include code examples
