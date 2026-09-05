# Install: golem-install

> Set up the golems ecosystem for the first time on a new machine. Checks CLI dependencies, wires MCP servers, creates skill symlinks. Use when: "set up golems", "install golems", "new machine setup", "wire skills". NOT for daily usage.

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
mkdir -p "$SKILLS_DIR/golem-install/workflows" "$SKILLS_DIR/golem-install/scripts"
curl -sL "$BASE/SKILL.md" -o "$SKILLS_DIR/golem-install/SKILL.md"
for wf in check-deps install-deps setup-symlinks setup-tokens validate wire-project; do
  curl -sL "$BASE/workflows/$wf.md" -o "$SKILLS_DIR/golem-install/workflows/$wf.md"
done
for sc in check-deps install-deps validate; do
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

## Usage

| CLI | Invocation |
|-----|-----------|
| Claude Code | `/golem-install` |
| Codex | `$golem-install` or mention it in the task |
| Cursor / Gemini | Reference the skill by name in your prompt |
