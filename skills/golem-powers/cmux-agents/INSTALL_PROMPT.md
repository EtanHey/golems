# Install: cmux-agents

> Spawn AI agents in cmux panes — Claude workers as splits, audits/research as surfaces. Covers Claude, Cursor, Gemini, Codex, Kiro, T3 Code. Includes monitoring, prompt delivery, and collab patterns. Use this skill whenever the user mentions cmux agents, terminal agents, split agents, multi-agent orchestration, or wants to spawn AI workers in visible terminal panes.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/cmux-agents
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/SKILL.md \
  -o ~/.claude/skills/cmux-agents/SKILL.md
```

### Scripts

```bash
mkdir -p ~/.claude/skills/cmux-agents/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/scripts/agent-status.sh \
  -o ~/.claude/skills/cmux-agents/scripts/agent-status.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/scripts/watch-agent.sh \
  -o ~/.claude/skills/cmux-agents/scripts/watch-agent.sh
chmod +x ~/.claude/skills/cmux-agents/scripts/*.sh
```

3. Verify:
```bash
ls ~/.claude/skills/cmux-agents/
```

## Usage

```
/cmux-agents
```
