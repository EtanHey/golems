# Install: 1password

> Use when managing secrets, credentials, API keys, or vault operations. Supports Environments (Beta) for .env mounting. Covers 1password, secrets, op, vault, migrate, credentials. NOT for: non-secret config (use regular config files).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/1password
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/SKILL.md \
  -o ~/.claude/skills/1password/SKILL.md
```

### Workflows

```bash
mkdir -p ~/.claude/skills/1password/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/workflows/add-secret.md \
  -o ~/.claude/skills/1password/workflows/add-secret.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/workflows/list-secrets.md \
  -o ~/.claude/skills/1password/workflows/list-secrets.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/workflows/migrate-env.md \
  -o ~/.claude/skills/1password/workflows/migrate-env.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/workflows/migrate-mcp.md \
  -o ~/.claude/skills/1password/workflows/migrate-mcp.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/workflows/troubleshoot.md \
  -o ~/.claude/skills/1password/workflows/troubleshoot.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/workflows/use-environment.md \
  -o ~/.claude/skills/1password/workflows/use-environment.md
```

### Scripts

```bash
mkdir -p ~/.claude/skills/1password/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/scripts/migrate-env.sh \
  -o ~/.claude/skills/1password/scripts/migrate-env.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/1password/scripts/scan-mcp-secrets.sh \
  -o ~/.claude/skills/1password/scripts/scan-mcp-secrets.sh
chmod +x ~/.claude/skills/1password/scripts/*.sh
```

3. Verify:
```bash
ls ~/.claude/skills/1password/
```

## Usage

```
/1password
```
