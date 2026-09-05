# Install: figma-loop

> Iterative Figma-to-implementation pixel-perfect verification loop. Use when implementing or refining UI from Figma designs. Drills on screenshots, comparing Figma vs implementation, fixing one thing at a time until 3 consecutive checks pass. Covers figma iteration, pixel perfect, design verification, ui drilling, figma comparison. NOT for: fetching Figma specs only (use figma-workflow docs), creating new components from scratch without a reference design.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/figma-loop/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/figma-loop
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/figma-loop/SKILL.md \
  -o ~/.claude/skills/figma-loop/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/skills/figma-loop/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/figma-loop/workflows/check.md \
  -o ~/.claude/skills/figma-loop/workflows/check.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/figma-loop/workflows/iterate.md \
  -o ~/.claude/skills/figma-loop/workflows/iterate.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/figma-loop/workflows/setup.md \
  -o ~/.claude/skills/figma-loop/workflows/setup.md
```

4. Download scripts:
```bash
mkdir -p ~/.claude/skills/figma-loop/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/figma-loop/scripts/check.sh \
  -o ~/.claude/skills/figma-loop/scripts/check.sh
chmod +x ~/.claude/skills/figma-loop/scripts/check.sh
```

5. Verify:
```bash
ls ~/.claude/skills/figma-loop/
```

## Usage

```
/figma-loop
```
