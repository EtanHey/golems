# Install: commit

> Use when ready to commit changes. Runs CodeRabbit review first, then commits if review passes. Supports Ralph mode for atomic commit + criterion marking. Covers commit, ralph commit, atomic commit. NOT for: pushing or creating PRs (use pr-loop).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/commit/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/commit
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/commit/SKILL.md \
  -o ~/.claude/commands/commit/SKILL.md
```

### Scripts

```bash
mkdir -p ~/.claude/commands/commit/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/commit/scripts/default.sh \
  -o ~/.claude/commands/commit/scripts/default.sh
chmod +x ~/.claude/commands/commit/scripts/*.sh
```

3. Verify:
```bash
ls ~/.claude/commands/commit/
```

## Usage

```
/commit
```
