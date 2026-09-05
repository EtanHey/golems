# Install: wizard

> Fresh machine setup wizard for the golems ecosystem. Checks prerequisites, creates config.yaml, clones repos, wires MCP servers via sync-config.sh, creates .claude.local.md, verifies BrainLayer.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/wizard/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/wizard
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/wizard/SKILL.md \
  -o ~/.claude/skills/wizard/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/skills/wizard/
```

## Usage

```
/wizard
```
