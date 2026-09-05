# Install: test-plan

> Use when preparing a PR for QA review. Generates manual testing checklist from git diff. Covers test plan, QA checklist, testing before merge. NOT for: automated tests (write those separately), code reviews (use coderabbit).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/test-plan/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/test-plan
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/test-plan/SKILL.md \
  -o ~/.claude/commands/test-plan/SKILL.md
```

3. Download scripts:
```bash
mkdir -p ~/.claude/commands/test-plan/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/test-plan/scripts/generate.sh \
  -o ~/.claude/commands/test-plan/scripts/generate.sh
chmod +x ~/.claude/commands/test-plan/scripts/generate.sh
```

4. Verify:
```bash
ls ~/.claude/commands/test-plan/
```

## Usage

```
/test-plan
```
