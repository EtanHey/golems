# Install: github

> Use when doing git operations, creating PRs, or managing GitHub issues. Provides gh CLI commands. Covers git, github, commits, PRs, issues, branches, worktrees. NOT for: Linear issues (use linear), code reviews (use coderabbit).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/github/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/github
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/github/SKILL.md \
  -o ~/.claude/commands/github/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/github/
```

## Usage

```
/github
```
