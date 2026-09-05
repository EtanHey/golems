# Install: email-golem

> Check email status, run manual triage, view recent scores. Use when asking about emails or wanting to check urgent messages.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/email-golem/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/email-golem
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/email-golem/SKILL.md \
  -o ~/.claude/commands/email-golem/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/email-golem/
```

## Usage

```
/email-golem
```
