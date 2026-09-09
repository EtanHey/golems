---
name: setup
description: Full fresh-machine setup workflow — step-by-step guide from prerequisites to verified BrainLayer connection
---

# Fresh Machine Setup Workflow

> Complete role-aware walkthrough for setting up the golems ecosystem from scratch.

## Phase 1: Prerequisites (Step 1)

Run the prerequisites check script:
```bash
bash ~/.claude/skills/wizard/scripts/default.sh
```

If any tool is missing, install it:

| Tool | macOS | Linux |
|------|-------|-------|
| brew | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` | [linuxbrew](https://brew.sh) |
| node | `brew install node` | `brew install node` or `nvm install --lts` |
| bun | `brew install oven-sh/bun/bun` | `curl -fsSL https://bun.sh/install \| bash` |
| claude | `brew install claude` | `npm install -g @anthropic-ai/claude-code` |
| gh | `brew install gh` then `gh auth login` | `brew install gh` then `gh auth login` |
| git | `xcode-select --install` | `sudo apt install git` |

Re-run the check after installing. Do NOT proceed until all 6 are green.

## Phase 2: Config (Step 2)

If `~/.golems/config.yaml` exists:
1. Read and display it
2. Run `sync-config.sh --validate` if available
3. Require `machineRole` to be exactly `workspace` or `daemon-host`; if absent or invalid, ask and write it before any repo action
4. Ask: use as-is or reconfigure?

If it doesn't exist:
1. Ask for machine role (`workspace` or `daemon-host`) with no default
2. Ask for workspace root (validate path exists)
3. Detect tool paths with `which`
4. Ask about opt-in features (all OFF by default)
5. Write config.yaml, including the explicit `machineRole`, with `mkdir -p ~/.golems`

## Phase 3: Artifacts and Repos (Step 3)

1. From the installed wizard bundle, run `bun <wizard-dir>/scripts/repo-action.mjs "$MACHINE_ROLE"`; it enumerates the sole classification source, `release-gate.json`. If the helper or bundled manifest is absent, stop and install/update the complete bundle from `INSTALL_PROMPT.md`.
2. `INSTALL`: install/update or report the named artifact. Never clone it, on either machine role.
3. `CLONE`: only `kind:"none"` on `workspace`; check `$REPOS_PATH/<repo>` and clone only when missing.
4. `REFUSE`: clone nothing and show the reason. Missing/invalid roles and unclassified repos fail closed.
5. Run `bun install` in golems after cloning it.

## Phase 4: Wire MCP Servers (Step 4)

1. Run `sync-config.sh --diff` — show what will change
2. Get user confirmation
3. Run `sync-config.sh --enforce` to apply

## Phase 5: Machine-Specific Config (Step 5)

For each existing checkout with a `CLAUDE.md`:
1. Check if `.claude.local.md` already exists — skip if so
2. Create `.claude.local.md` with local paths, tools, platform info
3. Verify `.gitignore` includes `.claude.local.md`

## Phase 6: BrainLayer Verification (Step 6)

1. Check `/tmp/brainbar.sock` exists
2. Check BrainBar process is running
3. Test with `brain_search(query="test", limit=1)`
4. Report status — don't block on failure

## Phase 7: Report (Step 7)

Display the full report with:
- All prerequisite versions
- Config location
- Repo status (cloned/existing)
- MCP wiring status
- BrainLayer connection
- Manual setup items remaining
