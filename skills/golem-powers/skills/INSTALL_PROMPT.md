# Install: skills

> Use when wanting to see what skills are available. Lists installed skills with descriptions. Covers list skills, search skills, discover skills, what skills. NOT for: using a specific skill (invoke that skill directly).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/skills/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/skills
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/skills/SKILL.md \
  -o ~/.claude/skills/skills/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/skills/skills/
```

## Usage

```
/skills
```
