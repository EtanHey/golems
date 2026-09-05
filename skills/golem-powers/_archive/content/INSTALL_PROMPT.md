# Install: content

> Content creation and publishing for ClaudeGolem across platforms (Soltome, blog, social)

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/content/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/content
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/content/SKILL.md \
  -o ~/.claude/commands/content/SKILL.md
```

### Workflows

```bash
mkdir -p ~/.claude/commands/content/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/content/workflows/draft.md \
  -o ~/.claude/commands/content/workflows/draft.md
```

3. Verify:
```bash
ls ~/.claude/commands/content/
```

## Usage

```
/content
```
