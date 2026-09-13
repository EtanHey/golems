# Install: wizard

> Fresh machine setup wizard for the golems ecosystem. Checks prerequisites, records an explicit machine role, installs release-gated artifacts, clones only checkout-backed repos on workspaces, wires MCP servers via sync-config.sh, creates .claude.local.md, and verifies BrainLayer.

## One-Paste Install

Copy this into a Claude Code session. This installs the full bundle without cloning the repository:

```
Install the wizard bundle from EtanHey/golems without cloning the repository. Download SKILL.md,
scripts/default.sh, scripts/repo-action.mjs, and the root release-gate.json into
~/.claude/skills/wizard (with scripts under its scripts directory), then run /wizard.
```

## Manual Install

1. Create the skill directory:
```bash
set -euo pipefail
mkdir -p ~/.claude/skills/wizard
```

2. Download the skill, executable helpers, and canonical artifact manifest:
```bash
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/wizard/SKILL.md \
  -o ~/.claude/skills/wizard/SKILL.md
mkdir -p ~/.claude/skills/wizard/scripts
curl -fsSL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/wizard/scripts/default.sh \
  -o ~/.claude/skills/wizard/scripts/default.sh
curl -fsSL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/wizard/scripts/repo-action.mjs \
  -o ~/.claude/skills/wizard/scripts/repo-action.mjs
curl -fsSL https://raw.githubusercontent.com/EtanHey/golems/master/release-gate.json \
  -o ~/.claude/skills/wizard/release-gate.json
```

3. Verify:
```bash
ls ~/.claude/skills/wizard/SKILL.md ~/.claude/skills/wizard/release-gate.json \
  ~/.claude/skills/wizard/scripts/default.sh ~/.claude/skills/wizard/scripts/repo-action.mjs
```

## Usage

```
/wizard
```
