# Install: worktrees

> Use when starting isolated feature work. Creates git worktrees to prevent branch cross-contamination. Covers worktree, isolated development, parallel features, branch isolation. NOT for: simple branch switching (use git checkout), Linear-only operations (use linear).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/worktrees/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/worktrees
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/worktrees/SKILL.md \
  -o ~/.claude/commands/worktrees/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/commands/worktrees/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/worktrees/workflows/cleanup.md \
  -o ~/.claude/commands/worktrees/workflows/cleanup.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/worktrees/workflows/create.md \
  -o ~/.claude/commands/worktrees/workflows/create.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/worktrees/workflows/from-linear.md \
  -o ~/.claude/commands/worktrees/workflows/from-linear.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/worktrees/workflows/list.md \
  -o ~/.claude/commands/worktrees/workflows/list.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/worktrees/workflows/switch.md \
  -o ~/.claude/commands/worktrees/workflows/switch.md
```

4. Verify:
```bash
ls ~/.claude/commands/worktrees/
```

## Usage

```
/worktrees
```
