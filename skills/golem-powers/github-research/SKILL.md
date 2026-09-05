---
name: github-research
description: "Audit unfamiliar repos: architecture, features, config gaps. Triggers: unfamiliar repo audit. NOT catchup."
---

# GitHub Research Skill

Use when auditing an **unfamiliar** codebase for the first time — architecture mapping, undocumented features, configuration gaps. **NOT** for catching up on your own branch (use `catchup` for that). BrainLayer first — check memory before reading files.

## Step 0: BrainLayer First

```
brain_search("<repo-name> architecture")
brain_search("<repo-name> patterns decisions")
brain_entity("<repo-name>")
```

If BrainLayer has it → start from what you know, fill gaps only. If not → proceed to Phase 1.

## Phase 1: Structure Discovery

```bash
# Directory tree (2 levels, ignore noise)
tree -L 2 -I 'node_modules|.git|dist|build|.next' .

# Config files
find . -maxdepth 2 \( -name "*.json" -o -name "*.yaml" -o -name "*.toml" \) | head -20

# Docs
find . -name "*.md" -not -path "*/node_modules/*" | head -20

# Monorepo?
ls packages/ 2>/dev/null || ls apps/ 2>/dev/null || echo "Not a monorepo"
```

## Phase 2: Entry Points

```bash
# Package scripts and main
cat package.json 2>/dev/null | grep -A10 '"scripts"\|"main"\|"bin"' | head -30

# TypeScript entry points
find . -name "index.ts" -not -path "*/node_modules/*" | head -10

# Rust entry points
find . -name "main.rs" -o -name "lib.rs" | grep -v target | head -10
```

## Phase 3: Key Files (READ THESE)

Always read if they exist:
1. `README.md` — official docs
2. `CLAUDE.md` — AI context (critical)
3. `package.json` / `Cargo.toml` — deps and scripts
4. Main entry file

## Phase 4: Function/Command Discovery

```bash
# TypeScript exports
grep -r "export function\|export const\|export async" --include="*.ts" . | grep -v node_modules | head -30

# Shell functions
grep -r "^function \|^[a-z_]*() {" --include="*.zsh" --include="*.sh" . | head -30

# CLI commands
grep -r "\.command(\|addCommand\|program\." --include="*.ts" . | grep -v node_modules | head -20

# Rust public API
grep -r "^pub fn\|^pub async fn" --include="*.rs" . | grep -v target | head -20
```

## Phase 5: Golem Ecosystem Context

When researching any golem repo, check cross-repo dependencies:

| Repo | Path | Purpose |
|------|------|---------|
| orchestrator | $ORCHESTRATOR_REPO | orcClaude — cross-repo coordination |
| golems | $HOME/Gits/golems | Monorepo — coach, shared, services |
| brainlayer | $HOME/Gits/brainlayer | Memory layer — BrainLayer MCP |
| voicelayer | $HOME/Gits/voicelayer | Voice I/O — VoiceBar + MCP |
| golem-terminal | $HOME/Gits/golem-terminal | Native macOS terminal for agents |
| golems-dashboard | $HOME/Gits/golems-dashboard | BrainLayer entity browser |

## Output Format

Write findings to `docs.local/research/<repo>-research.md`, then `brain_store` key findings with tags `["research", "<repo>"]`.

## Critique Waves Pattern

For thorough research, run multiple passes:

1. **Wave 1**: BrainLayer recall + structure (tree, find)
2. **Wave 2**: Read key files (README, CLAUDE.md, package.json)
3. **Wave 3**: Function/command extraction
4. **Wave 4**: Cross-reference with docs, find gaps
5. **Wave 5**: brain_store findings

Each wave writes to separate sections, then consolidate.
