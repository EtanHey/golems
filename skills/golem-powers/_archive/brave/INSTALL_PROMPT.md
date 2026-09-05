# Install: brave

> Use as fallback browser automation when Claude-in-Chrome MCP is unavailable. Covers browser control, navigation, screenshots, clicking, typing. NOT for: headless testing (use Playwright). Claude Code users should prefer MCP first.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/brave/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/brave
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/brave/SKILL.md \
  -o ~/.claude/commands/brave/SKILL.md
```

### Workflows

```bash
mkdir -p ~/.claude/commands/brave/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/brave/workflows/debugging.md \
  -o ~/.claude/commands/brave/workflows/debugging.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/brave/workflows/inspection.md \
  -o ~/.claude/commands/brave/workflows/inspection.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/brave/workflows/interaction.md \
  -o ~/.claude/commands/brave/workflows/interaction.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/brave/workflows/navigation.md \
  -o ~/.claude/commands/brave/workflows/navigation.md
```

3. Verify:
```bash
ls ~/.claude/commands/brave/
```

## Usage

```
/brave
```
