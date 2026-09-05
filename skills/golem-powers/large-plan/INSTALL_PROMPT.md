# Install: large-plan

> Scaffold and execute folder-based multi-phase plans with async agent collaboration. Use when planning large features, multi-PR workflows, or coordinating parallel agent work across phases. NOT for: single-file changes, simple bugs, quick tasks.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/large-plan/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/large-plan
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/large-plan/SKILL.md \
  -o ~/.claude/skills/large-plan/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/skills/large-plan/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/large-plan/workflows/collab.md \
  -o ~/.claude/skills/large-plan/workflows/collab.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/large-plan/workflows/execute-phase.md \
  -o ~/.claude/skills/large-plan/workflows/execute-phase.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/large-plan/workflows/scaffold.md \
  -o ~/.claude/skills/large-plan/workflows/scaffold.md
```

4. Download scripts:
```bash
mkdir -p ~/.claude/skills/large-plan/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/large-plan/scripts/scaffold-plan.sh \
  -o ~/.claude/skills/large-plan/scripts/scaffold-plan.sh
chmod +x ~/.claude/skills/large-plan/scripts/scaffold-plan.sh
```

5. Verify:
```bash
ls ~/.claude/skills/large-plan/
```

## Usage

```
/large-plan
```
