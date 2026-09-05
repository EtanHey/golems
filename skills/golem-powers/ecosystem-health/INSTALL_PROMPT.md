# Install: ecosystem-health

> Run ecosystem health checks — MCP connections, BrainLayer stats, skill evals, friction scans. Use this skill when asked about ecosystem health, maintenance checks, skill monitoring, 'is everything working', 'run a health check', 'what's broken', or when proactively auditing the system. Also triggers for 'maintenance Claude', 'ecosystem audit', 'skill eval', 'MCP status', or 'BrainLayer health'. Run this before and after major changes to catch regressions.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/ecosystem-health/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/ecosystem-health
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/ecosystem-health/SKILL.md \
  -o ~/.claude/skills/ecosystem-health/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/skills/ecosystem-health/
```

## Usage

```
/ecosystem-health
```
