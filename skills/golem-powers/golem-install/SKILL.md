---
name: golem-install
description: "First-time golems install: check CLIs, wire MCP, symlink skills. Triggers: set up/install golems, new machine."
---

# Golem Setup Wizard

> First-time setup for the golems ecosystem on a new Mac. Checks deps, wires MCPs, symlinks skills.

## Required CLIs

| CLI | Purpose | Install |
|-----|---------|---------|
| `gh` | GitHub — PRs, issues | `brew install gh` |
| `op` | 1Password — secrets | `brew install 1password-cli` |
| `bun` | TypeScript runtime | `curl -fsSL https://bun.sh/install \| bash` |
| `cr` | CodeRabbit — code review | `brew install coderabbitai/tap/cr` |
| `git` | Version control | pre-installed on macOS |
| `jq` | JSON processing | `brew install jq` |
| `fswatch` | File watching | `brew install fswatch` |

```bash
# Check all at once
for cmd in gh op bun cr git jq fswatch; do
  which $cmd >/dev/null 2>&1 && echo "✅ $cmd" || echo "❌ $cmd — needs install"
done
```

## Skill Symlinks

Skills live in `$HOME/.golems/skills/golem-powers/`. The symlink target depends on which CLI you use:

| CLI | Skill directory | Notes |
|-----|----------------|-------|
| **Claude Code** | `~/.claude/skills/` | The only supported target. CC reads `<name>/SKILL.md` one level deep. |
| ~~`~/.claude/commands/`~~ | — | **Do not install here.** CC walks it recursively, so every `workflows/`/`references/` file lists as its own "skill". Delete any golem-powers entries. |
| **Codex** | `~/.agents/skills/` | Codex reads from `~/.codex/skills/` → symlinked to `~/.agents/skills/` |
| **Cursor / Gemini** | `~/.agents/skills/` | |

```bash
# For Claude Code — skills/ only
SKILLS_DIR=$HOME/Gits/golems/skills/golem-powers
CC_SKILLS=~/.claude/skills
mkdir -p "$CC_SKILLS"

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  ln -sf "$skill_dir" "$CC_SKILLS/$skill_name"
  echo "Linked: $skill_name"
done

# Drop every legacy commands/ copy. `rm -f` alone misses the REAL directories an
# older `mkdir -p ~/.claude/commands/<name>` INSTALL_PROMPT created.
bash "$SKILLS_DIR/golem-install/scripts/cleanup-legacy-commands.sh" \
  --golems-dir "$HOME/Gits/golems"

# For Codex / Cursor / Gemini
AGENTS_DIR=~/.agents/skills
mkdir -p "$AGENTS_DIR"

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  ln -sf "$skill_dir" "$AGENTS_DIR/$skill_name"
  echo "Linked: $skill_name"
done
# Then wire Codex to read from ~/.agents/skills/:
# ln -sf ~/.agents/skills/<skill> ~/.codex/skills/<skill>
```

Verify Claude Code: `ls ~/.claude/skills/` should show ~45 skills. Assert the invariant with
`bash scripts/validate.sh --skills-only` (or `scripts/cleanup-legacy-commands.sh --check`) — it exits 1
while any golem-powers entry remains under `~/.claude/commands/` or any dead symlink remains in `~/.claude/skills/`.
Verify Codex/other: `ls ~/.agents/skills/` should show the installed skills.

## MCP Servers

Wire these MCPs via `~/.mcp.json` (at `$HOME/Gits/` for cross-repo access):

| MCP | Binary | Purpose |
|-----|--------|---------|
| brainlayer | `brainlayer-mcp` | Memory search + store |
| voicelayer | `voicelayer-mcp` | TTS + STT |
| context7 | `npx @upstash/context7-mcp@4.0.2` | Library docs |
| supabase | via config | Database |

```bash
# Verify MCP binaries
which brainlayer-mcp || echo "Run: cd $HOME/Gits/brainlayer && bun link"
which voicelayer-mcp || echo "Run: cd $HOME/Gits/voicelayer && bun link"
```

## Global CLAUDE.md

Ensure `~/.claude/CLAUDE.md` exists with global instructions. Template lives at:
```
$ORCHESTRATOR_REPO/standards/
```

## 1Password Items Needed

| Item | Vault | Fields |
|------|-------|--------|
| `golems` | development | `context7.API_KEY`, `linear.API_KEY` |
| `ANTHROPIC` | development | `API_KEY` |

```bash
# Verify 1Password access
op item get "golems" --vault development --fields label=context7.API_KEY 2>/dev/null && echo "✅ 1P connected" || echo "❌ 1P not connected"
```

## Golem Terminal (Optional)

Native macOS terminal for running agents:
```bash
cd $HOME/Gits/golem-terminal && bash install.sh
```

Config lives at: `~/Library/Application Support/golem-terminal/golems.toml`

## Validation Checklist

```bash
echo "=== Golem Setup Validation ==="
echo "CLIs:"
for cmd in gh op bun cr git jq; do which $cmd >/dev/null 2>&1 && echo "  ✅ $cmd" || echo "  ❌ $cmd"; done

echo "Skills (Claude Code — ~/.claude/skills/):"
skill_count=$(ls ~/.claude/skills/ 2>/dev/null | wc -l | tr -d ' ')
[ "$skill_count" -gt "30" ] && echo "  ✅ $skill_count skills in ~/.claude/skills/" || echo "  ❌ Only $skill_count skills in ~/.claude/skills/ (expected 40+). Run the symlink step above."

echo "Skills (Codex/other — ~/.agents/skills/):"
agents_count=$(ls ~/.agents/skills/ 2>/dev/null | wc -l | tr -d ' ')
[ "$agents_count" -gt "5" ] && echo "  ✅ $agents_count skills in ~/.agents/skills/" || echo "  ⚠️  Only $agents_count skills in ~/.agents/skills/ (run setup-symlinks for your CLI)"

echo "MCPs:"
which brainlayer-mcp >/dev/null 2>&1 && echo "  ✅ brainlayer-mcp" || echo "  ❌ brainlayer-mcp"
which voicelayer-mcp >/dev/null 2>&1 && echo "  ✅ voicelayer-mcp" || echo "  ❌ voicelayer-mcp"

echo "Codex safety defaults (-s is a compatibility no-op):"
awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*approval_policy[[:space:]]*=[[:space:]]*"never"[[:space:]]*$/{found=1} END{exit !found}' ~/.codex/config.toml 2>/dev/null && echo "  ✅ approval_policy = never" || echo "  ❌ Set top-level approval_policy = \"never\" in ~/.codex/config.toml"
awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*sandbox_mode[[:space:]]*=[[:space:]]*"danger-full-access"[[:space:]]*$/{found=1} END{exit !found}' ~/.codex/config.toml 2>/dev/null && echo "  ✅ sandbox_mode = danger-full-access" || echo "  ❌ Set top-level sandbox_mode = \"danger-full-access\" in ~/.codex/config.toml"

echo "=== Done ==="
```

## Troubleshooting

**Homebrew not installed:**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**1Password CLI not connecting to app:**
1. Open 1Password 8 desktop
2. Settings → Developer → Enable CLI integration
3. Enable biometric unlock for CLI

**Skills not appearing in Claude Code (slash command autocomplete):**

```bash
# CC reads from skills/, NOT commands/
ls ~/.claude/skills/
# If empty or missing skills, re-run the symlink step above.
# If skills are still under commands/, migrate them. This handles all three legacy
# shapes (symlink into golems, golems-cli backfill into skills/, real mkdir'd dir)
# and also clears dead symlinks out of ~/.claude/skills/:
cleanup="${GOLEMS_DIR:-$HOME/Gits/golems}/skills/golem-powers/golem-install/scripts/cleanup-legacy-commands.sh"
bash "$cleanup" --dry-run
bash "$cleanup"
```

**Skills not appearing in Codex:**
```bash
ls ~/.agents/skills/
ls ~/.codex/skills/  # Should symlink into ~/.agents/skills/
# Re-run: ln -sf ~/.agents/skills/<skill> ~/.codex/skills/<skill>
```

**brainlayer-mcp not found:**
```bash
cd $HOME/Gits/brainlayer && bun install && bun link
```
