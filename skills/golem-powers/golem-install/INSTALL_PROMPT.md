# Install: golem-install

> Set up the golems ecosystem for the first time on a new machine. Checks CLI dependencies, wires MCP servers, creates skill symlinks, runs the role-aware fresh-machine wizard, and lists installed skills. Use when: "set up golems", "install golems", "new machine setup", "wire skills", "wizard", "list my skills". NOT for daily usage.

## Skill Paths by CLI

| CLI | Skill directory |
|-----|----------------|
| **Claude Code** | `~/.claude/skills/` |
| **Codex** | `~/.agents/skills/` (symlinked from `~/.codex/skills/`) |
| **Cursor / Gemini** | `~/.agents/skills/` |

## One-Paste Install (Claude Code)

Copy this into a Claude Code session:

```
/slash-load https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/SKILL.md
```

## One-Paste Install (Codex / Cursor / Gemini)

Run this in a terminal:

```bash
BASE=https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install
SKILLS_DIR=~/.agents/skills
mkdir -p "$SKILLS_DIR/golem-install/workflows" "$SKILLS_DIR/golem-install/scripts" "$SKILLS_DIR/golem-install/references"
curl -sL "$BASE/SKILL.md" -o "$SKILLS_DIR/golem-install/SKILL.md"
for ref in wizard list-skills; do
  curl -sL "$BASE/references/$ref.md" -o "$SKILLS_DIR/golem-install/references/$ref.md"
done
for wf in check-deps install-deps setup-symlinks setup-tokens validate wire-project wizard-setup; do
  curl -sL "$BASE/workflows/$wf.md" -o "$SKILLS_DIR/golem-install/workflows/$wf.md"
done
for sc in check-deps install-deps validate wizard-preflight; do
  curl -sL "$BASE/scripts/$sc.sh" -o "$SKILLS_DIR/golem-install/scripts/$sc.sh"
  chmod +x "$SKILLS_DIR/golem-install/scripts/$sc.sh"
done
echo "Installed. Invoke as: \$golem-install (Codex) or per-CLI equivalent"
```

Then wire Codex to read from `~/.agents/skills/`:
```bash
# ~/.codex/skills/ should symlink into ~/.agents/skills/
ln -sf ~/.agents/skills/golem-install ~/.codex/skills/golem-install
```

## Manual Install (Claude Code)

1. Create the skill directory:
```bash
mkdir -p ~/.claude/skills/golem-install
```

2. Download the skill:
```bash
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/SKILL.md \
  -o ~/.claude/skills/golem-install/SKILL.md
```

3. Download workflows:
```bash
mkdir -p ~/.claude/skills/golem-install/workflows
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/workflows/check-deps.md \
  -o ~/.claude/skills/golem-install/workflows/check-deps.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/workflows/install-deps.md \
  -o ~/.claude/skills/golem-install/workflows/install-deps.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/workflows/setup-symlinks.md \
  -o ~/.claude/skills/golem-install/workflows/setup-symlinks.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/workflows/setup-tokens.md \
  -o ~/.claude/skills/golem-install/workflows/setup-tokens.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/workflows/validate.md \
  -o ~/.claude/skills/golem-install/workflows/validate.md
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/workflows/wire-project.md \
  -o ~/.claude/skills/golem-install/workflows/wire-project.md
```

4. Download scripts:
```bash
mkdir -p ~/.claude/skills/golem-install/scripts
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/scripts/check-deps.sh \
  -o ~/.claude/skills/golem-install/scripts/check-deps.sh
chmod +x ~/.claude/skills/golem-install/scripts/check-deps.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/scripts/install-deps.sh \
  -o ~/.claude/skills/golem-install/scripts/install-deps.sh
chmod +x ~/.claude/skills/golem-install/scripts/install-deps.sh
curl -sL https://raw.githubusercontent.com/EtanHey/golems/master/skills/golem-powers/golem-install/scripts/validate.sh \
  -o ~/.claude/skills/golem-install/scripts/validate.sh
chmod +x ~/.claude/skills/golem-install/scripts/validate.sh
```

5. Verify:
```bash
ls ~/.claude/skills/golem-install/
```

## Wizard Bundle (no clone)

The fresh-machine wizard needs its helpers and the canonical artifact manifest next to the skill.
Paste into a Claude Code session to install the complete bundle without cloning the repository:

```
Install the golem-install bundle from EtanHey/golems without cloning the repository. Download
SKILL.md, references/wizard.md, references/list-skills.md, workflows/wizard-setup.md,
scripts/wizard-preflight.sh, scripts/repo-action.mjs, scripts/install-codex-config.mjs, the root
config/codex directory, and the root release-gate.json into ~/.claude/skills/golem-install
(keeping each file's subdirectory), then run /golem-install and ask for the wizard.
```

Manual equivalent:
```bash
set -euo pipefail
RAW=https://raw.githubusercontent.com/EtanHey/golems/master
BASE=$RAW/skills/golem-powers/golem-install
DEST=~/.claude/skills/golem-install
mkdir -p "$DEST/references" "$DEST/workflows" "$DEST/scripts" "$DEST/config/codex/agents"
curl -fsSL "$BASE/SKILL.md" -o "$DEST/SKILL.md"
for f in references/wizard.md references/list-skills.md workflows/wizard-setup.md \
         scripts/wizard-preflight.sh scripts/repo-action.mjs scripts/install-codex-config.mjs; do
  curl -fsSL "$BASE/$f" -o "$DEST/$f"
done
for f in config/codex/config.toml config/codex/agents/recon.toml config/codex/agents/packet.toml release-gate.json; do
  curl -fsSL "$RAW/$f" -o "$DEST/$f"
done
ls "$DEST/SKILL.md" "$DEST/release-gate.json" "$DEST/scripts/repo-action.mjs" \
  "$DEST/scripts/install-codex-config.mjs" "$DEST/config/codex/agents/packet.toml"
```

## Usage

| CLI | Invocation |
|-----|-----------|
| Claude Code | `/golem-install` |
| Codex | `$golem-install` or mention it in the task |
| Cursor / Gemini | Reference the skill by name in your prompt |
