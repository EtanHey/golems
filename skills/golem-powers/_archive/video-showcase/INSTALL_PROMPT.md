# Install: video-showcase

> Create product/project showcase videos using Remotion (React). Takes project description + screenshots → generates compositions → renders MP4. Use when asked to make demo videos, product showcases, or animated project walkthroughs.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/video-showcase/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/video-showcase
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/video-showcase/SKILL.md \
  -o ~/.claude/commands/video-showcase/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/video-showcase/
```

## Usage

```
/video-showcase
```
