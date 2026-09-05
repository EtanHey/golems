# Installing /whats-new

## Quick Install

The skill is already available if you have golem-powers skills symlinked to `~/.claude/skills/`.

If not:

```bash
ln -sf $HOME/.golems/skills/golem-powers/whats-new ~/.claude/skills/whats-new
```

## Verify

```bash
ls -la ~/.claude/skills/whats-new
```

Should point to `$HOME/.golems/skills/golem-powers/whats-new`.

## Dependencies

- **exa MCP server** -- for fetching changelogs (required)
- **brainlayer MCP server** -- for storing findings and checking last review (required)
- **claude CLI** -- `claude --version` for current version detection
- **notify** -- for Telegram alerts on HIGH risk changes (optional)

## First Run

```
/whats-new
```

The first run will have no prior review baseline, so it shows the last 2-3 Claude Code versions and the latest Wispr Flow release.
