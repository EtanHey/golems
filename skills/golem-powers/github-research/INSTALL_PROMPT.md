# Install: github-research

> Use when auditing an UNFAMILIAR codebase for the first time — architecture mapping, undocumented features, configuration gaps. NOT for catching up on your own branch (use catchup). Always searches BrainLayer first before touching files.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/github-research/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/github-research
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/github-research/SKILL.md \
  -o ~/.claude/skills/github-research/SKILL.md
```

3. Download scripts:
```bash
mkdir -p ~/.claude/skills/github-research/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/github-research/scripts/explore-related.sh \
  -o ~/.claude/skills/github-research/scripts/explore-related.sh
chmod +x ~/.claude/skills/github-research/scripts/explore-related.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/github-research/scripts/explore.sh \
  -o ~/.claude/skills/github-research/scripts/explore.sh
chmod +x ~/.claude/skills/github-research/scripts/explore.sh
```

4. Verify:
```bash
ls ~/.claude/skills/github-research/
```

## Usage

```
/github-research
```
