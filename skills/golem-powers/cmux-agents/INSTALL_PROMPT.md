# Install: cmux-agents

> Spawn AI agents in cmux panes — Claude workers as splits, audits/research as surfaces. Covers Claude, Cursor, Gemini, Codex, T3 Code. Includes monitoring, prompt delivery, and collab patterns. Use this skill whenever the user mentions cmux agents, terminal agents, split agents, multi-agent orchestration, or wants to spawn AI workers in visible terminal panes.

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

Download the routed references:

```bash
mkdir -p ~/.claude/skills/cmux-agents/references
for name in tool-contracts delivery-and-recovery monitoring-and-collaboration platform-notes; do
  curl -sL "https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/references/${name}.md" \
    -o "$HOME/.claude/skills/cmux-agents/references/${name}.md"
done
```

Download the adapters and worker-prompt workflow routed from `SKILL.md`:

```bash
mkdir -p ~/.claude/skills/cmux-agents/adapters ~/.claude/skills/cmux-agents/workflows
for name in claude codex cursor; do
  curl -sL "https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/adapters/${name}.md" \
    -o "$HOME/.claude/skills/cmux-agents/adapters/${name}.md"
done
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/adapters/capabilities.yaml \
  -o ~/.claude/skills/cmux-agents/adapters/capabilities.yaml
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/workflows/prompt-audit.md \
  -o ~/.claude/skills/cmux-agents/workflows/prompt-audit.md
```

### Scripts

```bash
mkdir -p ~/.claude/skills/cmux-agents/scripts
for name in agent-functions check-naming-distinction delivery-gate run watch-agent; do
  curl -sL "https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/cmux-agents/scripts/${name}.sh" \
    -o "$HOME/.claude/skills/cmux-agents/scripts/${name}.sh"
done
chmod +x ~/.claude/skills/cmux-agents/scripts/*.sh
```

3. Verify:
```bash
find ~/.claude/skills/cmux-agents -maxdepth 2 -type f | sort
```

## Usage

```
/cmux-agents
```
