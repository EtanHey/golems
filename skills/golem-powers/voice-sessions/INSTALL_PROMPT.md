# Install: voice-sessions

> Use when debriefing meetings, practicing presentations, QA testing with voice, or capturing insights to Obsidian. Covers voice drilling, coaching, capture. NOT for: simple TTS announcements (use voice_speak directly).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/voice-sessions
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/SKILL.md \
  -o ~/.claude/skills/voice-sessions/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/skills/voice-sessions/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/workflows/code.md \
  -o ~/.claude/skills/voice-sessions/workflows/code.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/workflows/debrief.md \
  -o ~/.claude/skills/voice-sessions/workflows/debrief.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/workflows/practice.md \
  -o ~/.claude/skills/voice-sessions/workflows/practice.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/workflows/qa.md \
  -o ~/.claude/skills/voice-sessions/workflows/qa.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/workflows/quick.md \
  -o ~/.claude/skills/voice-sessions/workflows/quick.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/workflows/review.md \
  -o ~/.claude/skills/voice-sessions/workflows/review.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/voice-sessions/workflows/kg-review.md \
  -o ~/.claude/skills/voice-sessions/workflows/kg-review.md
```

4. Verify:
```bash
ls ~/.claude/skills/voice-sessions/
```

## Usage

```
/voice-sessions
```
