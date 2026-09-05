# Install: writing-skills

> Archived. Use `/skill-creator` for active skill creation, editing, auditing,
> and evaluation workflows. These install notes are preserved only for
> historical recovery.

> Use when creating new golem-powers skills, editing existing skills, or verifying skills work. Covers create skill, write skill, skill template, skill structure. NOT for: using existing skills (invoke them directly), superpowers skills (different structure).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/writing-skills/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/writing-skills
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/writing-skills/SKILL.md \
  -o ~/.claude/commands/writing-skills/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/commands/writing-skills/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/writing-skills/workflows/audit.md \
  -o ~/.claude/commands/writing-skills/workflows/audit.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/writing-skills/workflows/create.md \
  -o ~/.claude/commands/writing-skills/workflows/create.md
```

4. Download scripts:
```bash
mkdir -p ~/.claude/commands/writing-skills/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/_archive/writing-skills/scripts/create-skill.sh \
  -o ~/.claude/commands/writing-skills/scripts/create-skill.sh
chmod +x ~/.claude/commands/writing-skills/scripts/create-skill.sh
```

5. Verify:
```bash
ls ~/.claude/commands/writing-skills/
```

## Usage

```
/writing-skills
```
