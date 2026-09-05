# Install: railway

> Deploy and manage the golems cloud-worker on Railway. Use when deploying backend changes, checking logs, managing env vars, or restarting services. Wraps `railway` CLI. Covers railway, deploy, cloud-worker, redeploy, logs, variables. NOT for: Vercel deployments, frontend, Supabase.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/railway/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/railway
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/railway/SKILL.md \
  -o ~/.claude/commands/railway/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/commands/railway/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/railway/workflows/deploy.md \
  -o ~/.claude/commands/railway/workflows/deploy.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/railway/workflows/logs.md \
  -o ~/.claude/commands/railway/workflows/logs.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/railway/workflows/restart.md \
  -o ~/.claude/commands/railway/workflows/restart.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/railway/workflows/status.md \
  -o ~/.claude/commands/railway/workflows/status.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/railway/workflows/variables.md \
  -o ~/.claude/commands/railway/workflows/variables.md
```

4. Verify:
```bash
ls ~/.claude/commands/railway/
```

## Usage

```
/railway
```
