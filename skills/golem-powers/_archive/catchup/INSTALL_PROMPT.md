# Install: catchup

> Use when returning to work after any break — auto-detects depth. Short break (hours): reads only uncommitted changes. Long break (48h+) or context overflow: reads all branch changes vs main. Covers catchup, context recovery, refresh, rebuild understanding. NOT for: mid-task exploration (use Read/Grep directly).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/catchup/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/catchup
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/catchup/SKILL.md \
  -o ~/.claude/commands/catchup/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/catchup/
```

## Usage

```
/catchup
```
