# Install: critique-waves

> Use when needing multi-agent verification of complex work. Runs parallel critique agents until consensus. Covers verification, consensus, multi-agent review, validate work. NOT for: simple code reviews (use coderabbit), single-reviewer tasks.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/critique-waves/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/critique-waves
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/critique-waves/SKILL.md \
  -o ~/.claude/commands/critique-waves/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/commands/critique-waves/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/critique-waves/workflows/iteration.md \
  -o ~/.claude/commands/critique-waves/workflows/iteration.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/critique-waves/workflows/run-wave.md \
  -o ~/.claude/commands/critique-waves/workflows/run-wave.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/critique-waves/workflows/setup.md \
  -o ~/.claude/commands/critique-waves/workflows/setup.md
```

4. Download scripts:
```bash
mkdir -p ~/.claude/commands/critique-waves/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/critique-waves/scripts/init-tracker.sh \
  -o ~/.claude/commands/critique-waves/scripts/init-tracker.sh
chmod +x ~/.claude/commands/critique-waves/scripts/init-tracker.sh
```

5. Verify:
```bash
ls ~/.claude/commands/critique-waves/
```

## Usage

```
/critique-waves
```
