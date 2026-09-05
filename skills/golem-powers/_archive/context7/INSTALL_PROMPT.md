# Install: context7

> Use when needing current API references, function signatures, or library usage patterns. Looks up documentation via Context7 API. Covers docs lookup, library documentation, API reference, how to use library. NOT for: web search (use WebSearch), project-specific code (read the codebase).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/context7/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/context7
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/context7/SKILL.md \
  -o ~/.claude/commands/context7/SKILL.md
```

### Workflows

```bash
mkdir -p ~/.claude/commands/context7/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/context7/workflows/lookup.md \
  -o ~/.claude/commands/context7/workflows/lookup.md
```

### Scripts

```bash
mkdir -p ~/.claude/commands/context7/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/context7/scripts/default.sh \
  -o ~/.claude/commands/context7/scripts/default.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/context7/scripts/query-docs.sh \
  -o ~/.claude/commands/context7/scripts/query-docs.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/context7/scripts/resolve-library.sh \
  -o ~/.claude/commands/context7/scripts/resolve-library.sh
chmod +x ~/.claude/commands/context7/scripts/*.sh
```

3. Verify:
```bash
ls ~/.claude/commands/context7/
```

## Usage

```
/context7
```
