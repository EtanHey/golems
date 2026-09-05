# Install: convex

> Use when working with Convex backend - dev server, deployment, function execution, data import/export. Wraps npx convex CLI. Covers convex, backend, serverless, functions, schema. NOT for: other databases (Supabase, Firebase, etc.), frontend-only work.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/convex
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/SKILL.md \
  -o ~/.claude/commands/convex/SKILL.md
```

### Workflows

```bash
mkdir -p ~/.claude/commands/convex/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/data-export.md \
  -o ~/.claude/commands/convex/workflows/data-export.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/data-import.md \
  -o ~/.claude/commands/convex/workflows/data-import.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/deploy.md \
  -o ~/.claude/commands/convex/workflows/deploy.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/dev.md \
  -o ~/.claude/commands/convex/workflows/dev.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/run-function.md \
  -o ~/.claude/commands/convex/workflows/run-function.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/schema.md \
  -o ~/.claude/commands/convex/workflows/schema.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/troubleshooting.md \
  -o ~/.claude/commands/convex/workflows/troubleshooting.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/workflows/user-deletion.md \
  -o ~/.claude/commands/convex/workflows/user-deletion.md
```

### Scripts

```bash
mkdir -p ~/.claude/commands/convex/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/scripts/deploy.sh \
  -o ~/.claude/commands/convex/scripts/deploy.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/scripts/dev.sh \
  -o ~/.claude/commands/convex/scripts/dev.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/scripts/export-data.sh \
  -o ~/.claude/commands/convex/scripts/export-data.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/scripts/import-data.sh \
  -o ~/.claude/commands/convex/scripts/import-data.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/convex/scripts/run-function.sh \
  -o ~/.claude/commands/convex/scripts/run-function.sh
chmod +x ~/.claude/commands/convex/scripts/*.sh
```

3. Verify:
```bash
ls ~/.claude/commands/convex/
```

## Usage

```
/convex
```
