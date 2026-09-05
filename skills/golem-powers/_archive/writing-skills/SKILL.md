---
name: writing-skills
description: "Create, edit, and verify golem-powers skills using the standard SKILL.md structure, workflow files, adapters, templates, and eval fixtures. Use for new skills, structural edits, workflows/adapters, and pre-deploy validation. NOT for invoking existing skills, superpowers skills, or skill-creator agent workflows."
---

# Writing Golem-Powers Skills

> Meta-skill for creating executable skills. Skills are tools that Claude can invoke and automatically execute.

## Skill Structure

Every golem-powers skill MUST have this structure:

```
skills/golem-powers/<skill-name>/
├── SKILL.md              # REQUIRED: Frontmatter + documentation
├── CLAUDE.md             # OPTIONAL: Environment requirements, complex setup
├── scripts/              # REQUIRED: Executable files
│   ├── default.sh        # Pattern A: Bash script
│   └── run.sh            # Pattern B: Wrapper for TypeScript
├── src/                  # OPTIONAL: TypeScript source (Pattern B)
│   └── index.ts
├── package.json          # OPTIONAL: Required if using TypeScript
├── bun.lock              # OPTIONAL: Required if using TypeScript
└── workflows/            # OPTIONAL: Multi-step procedures
    ├── create.md
    └── verify.md
```

### SKILL.md Frontmatter (REQUIRED)

```yaml
---
name: <skill-name>
description: <when to use this skill - shown in skill discovery>
execute: scripts/default.sh  # Path to script Claude runs on invocation
---
```

The `execute:` field is what makes a skill executable. When Claude loads a skill with `execute:` frontmatter, it MUST run that script IMMEDIATELY via Bash before any other action.

---

## Dual Execution Patterns

### Pattern A: Bash Script

Best for: Simple CLI wrappers, no dependencies, quick operations.

**Frontmatter:**
```yaml
execute: scripts/review.sh
```

**Structure:**
```
skill-name/
├── SKILL.md
└── scripts/
    └── review.sh    # chmod +x
```

**Script conventions:**
- Scripts output Markdown for Claude to parse
- Use `set -euo pipefail` for safety
- Exit 0 on success, non-zero on failure
- Print errors to stderr, results to stdout
- **MUST use BASH_SOURCE for path detection** (see Path Standard below)

**Example script:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

echo "## Review Results"
echo ""
some-cli-tool review --format markdown
```

---

### Pattern B: TypeScript/Bun

Best for: Complex logic, API calls, type safety, structured data processing.

**Frontmatter:**
```yaml
execute: scripts/run.sh --action=default
```

**Structure:**
```
skill-name/
├── SKILL.md
├── scripts/
│   └── run.sh       # Wrapper that calls bun
├── src/
│   └── index.ts     # Main TypeScript file
├── package.json
└── bun.lock
```

**The wrapper script (scripts/run.sh):**
```bash
#!/usr/bin/env bash
set -euo pipefail

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

cd "$SKILL_DIR"
bun run src/index.ts "$@"
```

**TypeScript requirements:**
- Use Bun runtime (fast, TypeScript-native)
- Accept CLI arguments via `process.argv`
- Output Markdown or JSON to stdout
- Handle errors gracefully with exit codes

---

## CLI Pattern (for TypeScript skills)

Use flags to support multiple operations in one skill:

### --action Flag

```bash
execute: scripts/run.sh --action=default
```

Available actions defined in your TypeScript:
```typescript
const action = process.argv.find(a => a.startsWith('--action='))?.split('=')[1] || 'default';

switch (action) {
  case 'default':
    // Main skill behavior
    break;
  case 'verify':
    // Verification mode
    break;
  case 'list':
    // List mode
    break;
}
```

### --env Flag

For environment selection:
```bash
scripts/run.sh --action=deploy --env=prod
```

```typescript
const env = process.argv.find(a => a.startsWith('--env='))?.split('=')[1] || 'dev';
```

---

## Execution Rule

**CRITICAL:** When loading a golem-powers skill with `execute:` frontmatter, the agent MUST run that script IMMEDIATELY before any other action.

This means:
1. Agent loads the skill SKILL.md
2. Agent sees `execute: scripts/foo.sh`
3. Agent IMMEDIATELY runs the script via shell — path depends on CLI:
   - **Claude Code**: `bash ~/.claude/commands/<skill>/scripts/foo.sh`
   - **Codex / Cursor / Gemini**: `bash ~/.agents/skills/<skill>/scripts/foo.sh`
4. Agent reads the output
5. Only THEN does the agent proceed with other actions

This ensures skills are executable tools, not just documentation.

---

## Quick Actions

| What you want | Workflow |
|---------------|----------|
| Create a new skill | [workflows/create.md](workflows/create.md) |
| Audit skill structure | [workflows/audit.md](workflows/audit.md) |

---

## Template Generator

Use the included script to scaffold new skills:

```bash
# Claude Code
bash ~/.claude/commands/writing-skills/scripts/create-skill.sh \
  --name=my-skill \
  --type=bash

# Codex / Cursor / Gemini
bash ~/.agents/skills/writing-skills/scripts/create-skill.sh \
  --name=my-skill \
  --type=bash
```

Options:
- `--name=<skill-name>` (required): Name for the new skill
- `--type=bash|typescript` (required): Execution pattern
- `--output=<path>` (optional): Output directory (default: ./skills/golem-powers/)

This creates:
- Pattern A (bash): `SKILL.md`, `scripts/default.sh`
- Pattern B (typescript): `SKILL.md`, `scripts/run.sh`, `src/index.ts`, `package.json`

---

## Examples

See working examples in this repo:
- `skills/golem-powers/example-bash/` - Simple bash skill
- `skills/golem-powers/example-typescript/` - TypeScript/Bun skill

---

## Safety Rules

1. **Always chmod +x** - All scripts must be executable
2. **Test before commit** - Run `shellcheck` on all .sh files
3. **Output Markdown** - Scripts should return Markdown Claude can parse
4. **Exit codes matter** - 0 = success, non-zero = failure
5. **Use BASH_SOURCE pattern** - All scripts MUST self-detect their location

## Path Standard (CRITICAL)

All skill scripts MUST use this pattern for portability:

```bash
#!/usr/bin/env bash
set -euo pipefail

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Now use absolute paths relative to skill
source "$SKILL_DIR/config.sh"  # If needed
```

**For project detection** (when script needs prd-json/, package.json, etc.):

```bash
# Walk up from cwd to find project root
find_project_root() {
    local dir="$PWD"
    while [[ ! -d "$dir/prd-json" && "$dir" != "/" ]]; do
        dir="$(dirname "$dir")"
    done
    if [[ -d "$dir/prd-json" ]]; then
        echo "$dir"
    else
        echo ""
    fi
}

PROJECT_ROOT="$(find_project_root)"
if [[ -z "$PROJECT_ROOT" ]]; then
    echo "Error: Cannot find prd-json/ directory" >&2
    exit 1
fi
```

**Why this matters:**
- Skills are symlinked into a CLI-specific directory, but agents run from project directories:
  - Claude Code: `~/.claude/commands/<skill>/`
  - Codex / Cursor / Gemini: `~/.agents/skills/<skill>/`
- Relative paths like `./scripts/foo.sh` fail when cwd != skill directory
- BASH_SOURCE provides reliable self-location regardless of invocation context or CLI

See `contexts/skill-authoring.md` for full details.
