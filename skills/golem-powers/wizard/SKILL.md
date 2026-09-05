---
name: wizard
description: "Fresh-machine golems setup: prereqs, config, repos, MCP, BrainLayer. Triggers: setup, wizard, install golems."
---

# Golems Setup Wizard

> Automated fresh-machine setup. Checks prerequisites, writes config, clones repos, wires MCP servers, verifies connections.

## CARDINAL RULE

**ALL opt-in features are OFF by default.** The user must explicitly enable each one. No surprises, no unsolicited actions.

---

## Step 1: Check Prerequisites

Run all checks in parallel where possible:

```bash
for cmd in brew node bun claude gh git; do
  path=$(which $cmd 2>/dev/null)
  if [ -n "$path" ]; then
    version=$($cmd --version 2>/dev/null | head -1)
    echo "  $cmd : $path ($version)"
  else
    echo "  $cmd : NOT FOUND"
  fi
done
```

### Required Tools

| Tool | Required? | Install if missing |
|------|-----------|-------------------|
| `git` | **YES** | `xcode-select --install` (macOS) or `sudo apt install git` |
| `brew` | **YES** (macOS) | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| `node` | **YES** | `brew install node` or `nvm install --lts` |
| `bun` | **YES** | `brew install oven-sh/bun/bun` or `curl -fsSL https://bun.sh/install \| bash` |
| `claude` | **YES** | `brew install claude` or `npm install -g @anthropic-ai/claude-code` |
| `gh` | **YES** | `brew install gh` then `gh auth login` |

**If any required tool is missing:** List what's missing, provide install commands, and ask the user to install them before continuing. Do NOT proceed without all 6 tools.

**After gh is confirmed installed, verify auth:**
```bash
gh auth status
```
If not authenticated, guide the user through `gh auth login`.

---

## Step 2: Read or Create ~/.golems/config.yaml

Check if config exists:

```bash
cat ~/.golems/config.yaml 2>/dev/null
```

### If config.yaml EXISTS:

1. Display the current config to the user (reposPath, tools, features, contextProfiles)
2. Validate it: `bash <reposPath>/orchestrator/scripts/sync-config.sh --validate` (substituting the actual reposPath from config)
3. Ask: **"Config found. Use it as-is, or reconfigure?"**
4. If use as-is -> jump to Step 3 (clone repos)
5. If reconfigure -> continue below

### If config.yaml DOES NOT EXIST:

Create it interactively:

1. **Ask for workspace root** (parent dir for repos, e.g., `~/Gits`):
   - Validate the path exists: `ls -d "<expanded_path>" 2>/dev/null`
   - If invalid -> re-ask. Do NOT proceed with nonexistent path.
   - Expand `~` to full path before writing.

2. **Detect tool paths** (store absolute paths for launchd compatibility):
   ```bash
   which claude && which gh && which bun && which node && which git
   ```

3. **Ask about features** (all OFF by default):

   | Feature | Default | Description |
   |---------|---------|-------------|
   | `nightShift` | **OFF** | Autonomous improvement loop at 3am |
   | `telegram` | **OFF** | Telegram notifications |
   | `emailGolem` | **OFF** | Email triage and scoring |

4. **Write the config:**
   ```bash
   mkdir -p ~/.golems
   ```

   Write `~/.golems/config.yaml` with this structure:
   ```yaml
   # Golems Configuration
   reposPath: "<workspace_root>"
   stateDir: "<home>/.golems-zikaron"

   tools:
     claude: "<path>"
     gh: "<path>"
     # ... other detected tools

   features:
     nightShift: false
     telegram: false
     emailGolem: false

   mcpServers:
     brainlayer:
       command: socat
       args: ["STDIO", "UNIX-CONNECT:/tmp/brainbar.sock"]
     context7:
       command: npx
       args: ["-y", "@upstash/context7-mcp@latest"]
     supabase:
       command: npx
       args: ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "<token>"]

   contextProfiles:
     # Start with one profile per cloned repo — user adds more later
   ```

   Show the written config to the user for confirmation.

---

## Step 3: Clone Required Repos

Read `reposPath` from config.yaml. Check which repos exist:

```bash
REPOS_PATH=$(python3 -c "import yaml; print(yaml.safe_load(open('$HOME/.golems/config.yaml'))['reposPath'])")
for repo in golems orchestrator brainlayer; do
  if [ -d "$REPOS_PATH/$repo" ]; then
    echo "  $repo : EXISTS"
  else
    echo "  $repo : NOT FOUND — will clone"
  fi
done
```

### Required Repos

| Repo | URL | Purpose |
|------|-----|---------|
| `golems` | `git@github.com:EtanHey/golems.git` | Main monorepo (skills, packages) |
| `orchestrator` | `git@github.com:EtanHey/orchestrator.git` | Scripts, sync-config.sh, plans |
| `brainlayer` | `git@github.com:EtanHey/brainlayer.git` | Memory layer (BrainBar daemon) |

**For each missing repo:**
```bash
cd "$REPOS_PATH"
gh repo clone EtanHey/<repo>
```

**After cloning golems, install dependencies:**
```bash
cd "$REPOS_PATH/golems" && bun install
```

---

## Step 4: Run sync-config.sh

Wire MCP servers across all repos using the config.yaml source of truth:

```bash
bash "$REPOS_PATH/orchestrator/scripts/sync-config.sh" --diff
```

Show the diff output to the user. Ask:
> "This is what sync-config.sh will change. Apply these changes?"

If yes:
```bash
bash "$REPOS_PATH/orchestrator/scripts/sync-config.sh" --enforce
```

If sync-config.sh is not available (orchestrator not yet cloned or script missing), skip this step and note it in the final report.

---

## Step 5: Create .claude.local.md in Each Repo

For each repo in `reposPath` that has a `CLAUDE.md`, create a `.claude.local.md` with machine-specific paths:

```bash
for repo in golems orchestrator brainlayer; do
  repo_path="$REPOS_PATH/$repo"
  if [ -f "$repo_path/CLAUDE.md" ] && [ ! -f "$repo_path/.claude.local.md" ]; then
    echo "Creating .claude.local.md for $repo"
  fi
done
```

Template for `.claude.local.md`:
```markdown
# Local Machine Config (not committed)

## Paths
- Repos: <reposPath>
- State: <stateDir>
- Config: ~/.golems/config.yaml

## Tools
- claude: <path>
- gh: <path>
- bun: <path>

## Environment
- Platform: <uname -s>
- Shell: <echo $SHELL>
- Node: <node --version>
- Bun: <bun --version>
```

**IMPORTANT:** Check `.gitignore` includes `.claude.local.md` in each repo. If not, warn the user to add it.

---

## Step 6: Verify BrainLayer MCP Connection

Check if BrainLayer is running:

```bash
# Check if BrainBar socket exists
ls -la /tmp/brainbar.sock 2>/dev/null

# Check if BrainBar process is running
pgrep -f BrainBar 2>/dev/null || pgrep -f brainbar 2>/dev/null
```

### If BrainBar socket exists:

Test the MCP connection by calling `brain_search` with a simple query:
```
brain_search(query="test connection", limit=1)
```

- If it returns results (even empty) -> BrainLayer is connected
- If it errors -> report the error, suggest restarting BrainBar

### If BrainBar is NOT running:

Report:
> "BrainLayer MCP is not available. BrainBar daemon is not running.
> To start: open /Applications/BrainBar.app
> Skills that use memory (coach, catchup, research) will have reduced functionality."

Do NOT block setup on BrainLayer — it's optional but recommended.

---

## Step 7: Final Report

Display a summary of everything that was configured:

```
=== Golems Setup Complete ===

Prerequisites:
  brew    : $(brew --prefix)/bin/brew (4.x)
  node    : $(brew --prefix)/bin/node (v22.x)
  bun     : $(brew --prefix)/bin/bun (1.x)
  claude  : ~/.local/bin/claude (1.x)
  gh      : /usr/local/bin/gh (2.x)
  git     : /usr/bin/git (2.x)

Config:       ~/.golems/config.yaml
Workspace:    ~/Gits
State dir:    ~/.golems-zikaron

Repos:
  golems        : CLONED (bun install done)
  orchestrator  : CLONED
  brainlayer    : CLONED

MCP Servers:   sync-config.sh applied (3 servers wired)
.claude.local:  Created in 3 repos

BrainLayer:    CONNECTED (BrainBar running)

Skills:        Symlinked from golems/skills/golem-powers/

=== Manual Setup Needed ===
  - [ ] Configure Supabase access token in config.yaml
  - [ ] Set up 1Password: op account list
  - [ ] Enable Telegram if needed: update config.yaml features.telegram
```

List anything that needs manual setup — secrets, tokens, services that couldn't be auto-configured.

---

## Anti-Patterns

- **NEVER** enable features without explicit user consent
- **NEVER** write config with an invalid/nonexistent workspace path
- **NEVER** overwrite existing config without asking first
- **NEVER** proceed without all 6 required tools installed
- **NEVER** clone repos without confirming the workspace path exists
- **NEVER** run sync-config.sh --enforce without showing --diff first
- **NEVER** block setup on BrainLayer — it's optional
- **NEVER** commit .claude.local.md — it's machine-specific

## Composability

This skill is invoked by:
- `/wizard` slash command in Claude Code
- `INSTALL_PROMPT.md` paste into a Claude session
- Fresh machine setup flow

It uses:
- `sync-config.sh` from orchestrator repo
- `config.yaml` as single source of truth
- BrainLayer MCP for connection verification
