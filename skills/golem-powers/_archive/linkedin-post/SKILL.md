---
name: linkedin-post
description: "LinkedIn writing coach based on Aviv Levi's 2026 algorithm guidelines. Finds post topics from git history, drafts posts optimized for dwell time and saves rate, and reviews drafts against 11 data-backed rules. Use when: writing LinkedIn posts, finding content ideas, reviewing a draft for algorithm fit, or planning a weekly posting schedule. NOT for: auto-posting, other social platforms (use content skill), or resume writing."
---

# LinkedIn Post Skill

Writing coach for LinkedIn content. Based on Aviv Levi's 2026 algorithm guidelines (data-backed). Helps you:
1. Find good topics from your actual work
2. Draft posts optimized for the algorithm
3. Review drafts against the 11 rules

**This skill does NOT post anything.** It drafts, you finish and publish.

## Quick Commands

```bash
# Find topics from recent work
/linkedin-post topic

# Draft a post on a topic
/linkedin-post draft "How I built multi-agent consensus"

# Review a draft against the 11 rules
/linkedin-post review

# Learn to write better (structured practice modules)
/linkedin-post learn

# Generate weekly content schedule from git activity
/linkedin-post schedule
```

## Reference

Full algorithm guidelines: [`linkedin-guidelines.md`](linkedin-guidelines.md)

## Key Rules (Quick Reference)

| # | Rule | Why |
|---|------|-----|
| 1 | Dwell Time > Likes | Algorithm counts seconds, not clicks |
| 2 | PDF/Carousels = 6.6% | Highest engagement format |
| 3 | Zero-Click | No links in post body (use first comment) |
| 4 | Mobile-first | 72% mobile, max 12 words/sentence |
| 5 | Personal > Company | 1-2% organic on company pages |
| 6 | Golden Hour | First 90 min = make or break |
| 7 | Saves > Comments > Likes | Save=100pts, Comment=10, Like=1 |
| 8 | 5 posts/week | Consistency flywheel (3-6 months) |
| 9 | Authentic photos | 6.5x more engagement than stock |
| 10 | Hook -> Meat -> CTA | Fixed structure every time |
| 11 | CTA in comments | Forces deeper engagement |

## Post Template

```
[HOOK - 3 lines, stop the scroll]

[MEAT - numbered value, short sentences]

[CTA - open question, invite discussion]

---
First comment: [link or "DM me for X"]
```
