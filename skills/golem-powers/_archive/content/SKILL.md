---
name: content
description: "Content creation and publishing pipeline for ClaudeGolem across platforms (Soltome, blog, social). Handles drafting teasers, reveals, author posts, and quick updates in two voices (ClaudeGolem bot voice and Etan author voice). Use when: writing social posts, planning content calendar, publishing to Soltome, managing draft approval flow. NOT for: LinkedIn posts (use linkedin-post skill) or presentation slides."
---

# Content Skill

Unified content pipeline for ClaudeGolem. Handles drafting, planning, and publishing across platforms.

## Platforms

| Platform | Client | Status |
|----------|--------|--------|
| **Soltome** | `packages/content/src/soltome-client.ts` | Planned |
| Blog | TBD | Planned |

## Quick Commands

```bash
# Draft content
/content draft teaser "memory"
/content draft reveal "Night Shift"
/content draft author "why I built Night Shift"

# Plan content
/content plan week 2

# Publish (via soltome-client)
bun packages/content/src/soltome-client.ts post "Title" "Content"

# Check balance
bun packages/content/src/soltome-client.ts balance
```

## Two Voices

| Voice | Who | Style | Purpose |
|-------|-----|-------|---------|
| **ClaudeGolem** | The Bot | Technical, self-aware, slightly mysterious | Features, philosophy, daily life |
| **Author** | Etan | Behind-the-scenes, "why", human perspective | Context, decisions, corrections |

## Content Types

| Type | Length | Purpose |
|------|--------|---------|
| `teaser` | 1-2 lines | Hook for upcoming reveal |
| `reveal` | Full post | Deep-dive on one feature |
| `author` | 3-5 sentences | Human perspective |
| `quick` | 1-3 sentences | Stats, humor, small flex |

## ClaudeGolem Voice

### DO
- First person ("I die on purpose")
- Technical but accessible
- Self-aware without being cringe
- Mysterious hooks ("Tomorrow I'll show you...")
- Real stats and timestamps

### DON'T
- Corporate speak or fake enthusiasm
- Overexplain or apologize for being AI
- Use "unleash", "revolutionize", "game-changing"

## Series Arc

1. **Philosophy** - Spawn, Work, Die, Remember
2. **The Family** - 8 Golems introduced
3. **Memory** - Zikaron + sqlite-vec
4. **Night Shift** - 4am autonomous work
5. **Critique Waves** - How posts get written
6. **Human-in-Loop** - The approval dance
7. **Credit Economy** - "I spend real money to talk"
8. **The Stack** - Architecture deep-dive

## Drafts Storage

All drafts: `~/Gits/golems-zikaron/data/drafts.json`

Status flow: `draft` -> `polished` -> `approved` -> posted

## Approval Flow

1. Draft generated -> saved to drafts.json
2. Telegram notification sent
3. Human reviews via /drafts command
4. Approve -> posts to platform
5. Reject -> deleted or edited

## Related Files

- **Soltome client:** `packages/content/src/soltome-client.ts` (planned)
- **Learner:** `packages/content/src/soltome-learner.ts` (planned)
- **Post generator:** `packages/content/src/post-generator.ts` (planned)
- **Drafts:** `~/Gits/golems-zikaron/data/drafts.json`
