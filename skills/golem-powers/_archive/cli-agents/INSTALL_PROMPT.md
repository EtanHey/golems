# Install: cli-agents

> Archived. Use `/cmux-agents` for visible agent spawning and `/repogolem` for
> launcher flags. These install notes are preserved only for historical recovery.

> Run external CLI agents (Gemini, Cursor, Codex, Kiro, Claude) via cmux panes. Workers split in current workspace. Audits/research open in a new named workspace. All agents are interactive and visible.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/cli-agents/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/cli-agents
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/cli-agents/SKILL.md \
  -o ~/.claude/commands/cli-agents/SKILL.md
```

### Scripts

```bash
mkdir -p ~/.claude/commands/cli-agents/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/cli-agents/scripts/run.sh \
  -o ~/.claude/commands/cli-agents/scripts/run.sh
chmod +x ~/.claude/commands/cli-agents/scripts/*.sh
```

3. Verify:
```bash
ls ~/.claude/commands/cli-agents/
```

## Usage

```
/cli-agents
```
