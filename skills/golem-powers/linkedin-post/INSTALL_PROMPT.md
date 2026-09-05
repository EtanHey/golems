# Install: linkedin-post

> LinkedIn writing coach — find topics from code history, draft posts following 2026 algorithm rules, review drafts. NOT auto-posting.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/linkedin-post/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/linkedin-post
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/linkedin-post/SKILL.md \
  -o ~/.claude/skills/linkedin-post/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/skills/linkedin-post/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/linkedin-post/workflows/draft.md \
  -o ~/.claude/skills/linkedin-post/workflows/draft.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/linkedin-post/workflows/learn.md \
  -o ~/.claude/skills/linkedin-post/workflows/learn.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/linkedin-post/workflows/review.md \
  -o ~/.claude/skills/linkedin-post/workflows/review.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/linkedin-post/workflows/schedule.md \
  -o ~/.claude/skills/linkedin-post/workflows/schedule.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/linkedin-post/workflows/topic.md \
  -o ~/.claude/skills/linkedin-post/workflows/topic.md
```

4. Verify:
```bash
ls ~/.claude/skills/linkedin-post/
```

## Usage

```
/linkedin-post
```
