# Install: prd

> Use when planning a feature, starting a new project, or asked to create a PRD. Generates JSON-based PRD for Ralph. Adding stories uses update.json pattern. Covers PRD, create PRD, plan feature, Ralph stories. NOT for: running Ralph (user runs externally).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/prd/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/prd
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/prd/SKILL.md \
  -o ~/.claude/skills/prd/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/skills/prd/
```

## Usage

```
/prd
```
