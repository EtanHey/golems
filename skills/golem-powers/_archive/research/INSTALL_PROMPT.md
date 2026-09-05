# Install: research

> Deep web research orchestrator. Routes research tasks to the best backend — internal subagents, CLI agents (Gemini/Cursor), or the researcher subagent. Use when asked to research, investigate, compare, find alternatives, or deep-dive into any topic. Covers web research, company research, code pattern research, and pre-implementation research.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/research/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/research
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/research/SKILL.md \
  -o ~/.claude/commands/research/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/research/
```

## Usage

```
/research
```
