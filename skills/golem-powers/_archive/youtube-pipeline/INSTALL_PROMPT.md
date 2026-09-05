# Install: youtube-pipeline

> Extract knowledge from YouTube videos into BrainLayer. Use when user shares a YouTube link or asks to process/watch/extract from a video. Chains exa (transcript) -> brain_digest (entities/relations) -> brain_store (conclusions). Works with any YouTube URL.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/youtube-pipeline/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/youtube-pipeline
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/youtube-pipeline/SKILL.md \
  -o ~/.claude/commands/youtube-pipeline/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/youtube-pipeline/
```

## Usage

```
/youtube-pipeline
```
