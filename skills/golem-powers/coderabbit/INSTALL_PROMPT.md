# Install: coderabbit

> Use when reviewing uncommitted changes, preparing PRs, requesting or receiving code review, handling reviewer comments, checking security/secrets/a11y/code quality, or deciding whether to accept or reject reviewer feedback. Runs AI review via CLI and covers review triage, false-positive pushback, red/blue team profiles, PR-ready gates. NOT for: runtime debugging or test execution.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/coderabbit
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/SKILL.md \
  -o ~/.claude/skills/coderabbit/SKILL.md
```

### Workflows

```bash
mkdir -p ~/.claude/skills/coderabbit/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/accessibility.md \
  -o ~/.claude/skills/coderabbit/workflows/accessibility.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/pr-ready.md \
  -o ~/.claude/skills/coderabbit/workflows/pr-ready.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/review.md \
  -o ~/.claude/skills/coderabbit/workflows/review.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/red-team.md \
  -o ~/.claude/skills/coderabbit/workflows/red-team.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/secrets.md \
  -o ~/.claude/skills/coderabbit/workflows/secrets.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/security.md \
  -o ~/.claude/skills/coderabbit/workflows/security.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/verify.md \
  -o ~/.claude/skills/coderabbit/workflows/verify.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/workflows/blue-team.md \
  -o ~/.claude/skills/coderabbit/workflows/blue-team.md
```

### References

```bash
mkdir -p ~/.claude/skills/coderabbit/references
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/references/red-team-prompt.md \
  -o ~/.claude/skills/coderabbit/references/red-team-prompt.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/references/blue-team-prompt.md \
  -o ~/.claude/skills/coderabbit/references/blue-team-prompt.md
```

### Scripts

```bash
mkdir -p ~/.claude/skills/coderabbit/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/scripts/accessibility.sh \
  -o ~/.claude/skills/coderabbit/scripts/accessibility.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/scripts/pr-ready.sh \
  -o ~/.claude/skills/coderabbit/scripts/pr-ready.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/scripts/review.sh \
  -o ~/.claude/skills/coderabbit/scripts/review.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/scripts/secrets.sh \
  -o ~/.claude/skills/coderabbit/scripts/secrets.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/coderabbit/scripts/security.sh \
  -o ~/.claude/skills/coderabbit/scripts/security.sh
chmod +x ~/.claude/skills/coderabbit/scripts/*.sh
```

3. Verify:
```bash
ls ~/.claude/skills/coderabbit/
```

## Usage

```
/coderabbit
```
