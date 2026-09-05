# Install: ralph-commit

> Use when reaching a "Commit:" criterion in Ralph stories. Atomically commits and marks criterion checked. Covers ralph commit, atomic commit, commit criterion. NOT for: regular git commits (use git directly), commits outside Ralph workflow.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/ralph-commit/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/ralph-commit
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/ralph-commit/SKILL.md \
  -o ~/.claude/commands/ralph-commit/SKILL.md
```

3. Download scripts:
```bash
mkdir -p ~/.claude/commands/ralph-commit/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/ralph-commit/scripts/run.sh \
  -o ~/.claude/commands/ralph-commit/scripts/run.sh
chmod +x ~/.claude/commands/ralph-commit/scripts/run.sh
```

4. Verify:
```bash
ls ~/.claude/commands/ralph-commit/
```

## Usage

```
/ralph-commit
```
