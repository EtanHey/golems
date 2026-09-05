# Install: notify

> Send Telegram notification to user when task completes

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/notify/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/notify
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/notify/SKILL.md \
  -o ~/.claude/commands/notify/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/notify/
```

## Usage

```
/notify
```
