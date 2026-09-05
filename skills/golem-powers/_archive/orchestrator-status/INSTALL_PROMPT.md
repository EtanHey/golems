# Install: orchestrator-status

> Ecosystem-wide status collection and orientation. Use when returning to work, starting a new session, when the user says "where were we", "what's the status", "catch me up", "what happened", or any time you need to understand the current state across projects.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/orchestrator-status/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/orchestrator-status
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/orchestrator-status/SKILL.md \
  -o ~/.claude/commands/orchestrator-status/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/orchestrator-status/
```

## Usage

```
/orchestrator-status
```
