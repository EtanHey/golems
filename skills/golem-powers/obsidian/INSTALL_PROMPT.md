# Install: obsidian

> Use when accessing Obsidian vault notes - reading, searching, listing, or organizing notes. Covers obsidian, notes, vault, ideas, diary, memos. NOT for: general file operations outside the vault.

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/obsidian/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/obsidian
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/obsidian/SKILL.md \
  -o ~/.claude/skills/obsidian/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/skills/obsidian/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/obsidian/workflows/read.md \
  -o ~/.claude/skills/obsidian/workflows/read.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/obsidian/workflows/recent.md \
  -o ~/.claude/skills/obsidian/workflows/recent.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/obsidian/workflows/search.md \
  -o ~/.claude/skills/obsidian/workflows/search.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/obsidian/workflows/write.md \
  -o ~/.claude/skills/obsidian/workflows/write.md
```

4. Verify:
```bash
ls ~/.claude/skills/obsidian/
```

## Usage

```
/obsidian
```
