# Install: code-review

> Use when requesting or receiving code review. Covers dispatching reviewers, reading feedback, classifying issues, pushing back on wrong suggestions, and implementing fixes. Supersedes superpowers:requesting-code-review and superpowers:receiving-code-review.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/code-review/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/code-review
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/code-review/SKILL.md \
  -o ~/.claude/commands/code-review/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/code-review/
```

## Usage

```
/code-review
```
