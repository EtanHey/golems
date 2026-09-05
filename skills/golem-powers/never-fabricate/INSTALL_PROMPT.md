# Install: never-fabricate

> MANDATORY before reporting on any file contents, test results, agent outputs, or audit findings. If you haven't Read() it, you don't know what's in it. Period. Use when summarizing results, reporting on agent work, or claiming anything is "green" or "complete."

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/never-fabricate/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/never-fabricate
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/never-fabricate/SKILL.md \
  -o ~/.claude/skills/never-fabricate/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/skills/never-fabricate/
```

## Usage

```
/never-fabricate
```
