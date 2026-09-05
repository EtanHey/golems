# Install: presentation-builder

> Build and polish presentations using Michal's workshop method + Oren Efraim's rules. Guides users through premise, framing, drafting, polishing, opening/closing, and practice. Works with voice (VoiceLayer) or text.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/presentation-builder/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/presentation-builder
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/presentation-builder/SKILL.md \
  -o ~/.claude/skills/presentation-builder/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/skills/presentation-builder/
```

## Usage

```
/presentation-builder
```
