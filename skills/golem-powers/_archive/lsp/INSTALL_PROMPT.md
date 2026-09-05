# Install: lsp

> Use when needing semantic code navigation - find definitions, references, or callers. Covers LSP, go to definition, find references, hover, code intelligence. NOT for: text pattern searches (use grep), file discovery (use glob).

## One-Paste Install

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/lsp/SKILL.md
```

## Manual Install

1. Create the skill directory:
```bash
mkdir -p ~/.claude/commands/lsp
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/lsp/SKILL.md \
  -o ~/.claude/commands/lsp/SKILL.md
```

3. Verify:
```bash
ls ~/.claude/commands/lsp/
```

## Usage

```
/lsp
```
