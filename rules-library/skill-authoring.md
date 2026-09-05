# Skill Authoring Standards

## Path Resolution Standard

All golem-powers skills MUST use self-detecting paths to work from any current working directory.

### The Problem

Skills are installed as symlinks in `~/.claude/skills/` but users invoke Claude from their project directories. This creates three different contexts:

1. **Skill install dir**: `~/.claude/skills/golem-powers/skill-name/`
2. **Repo source dir**: `~/.config/claude-golem/skills/golem-powers/skill-name/`  
3. **User's cwd**: `/Users/username/Gits/some-project/`

### The Solution: BASH_SOURCE Self-Detection

Every script MUST start with this pattern:

```bash
#!/bin/bash
# Get script directory (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Now use absolute paths relative to skill
source "$SKILL_DIR/config.sh"
```

### For PRD/Project Detection

When scripts need to find the user's project files (prd-json/, package.json, etc.), use the walk-up pattern:

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
    echo "Error: Cannot find prd-json/ directory"
    exit 1
fi
```

### SKILL.md Execute Patterns

In SKILL.md frontmatter, reference scripts relative to skill directory:

```markdown
---
execute: scripts/run.sh --action=stats
---
```

Claude will automatically resolve this relative to the skill's base directory.

### Examples to Follow

- ✅ **ralph-commit/scripts/run.sh** - Uses BASH_SOURCE and walks up to find prd-json/
- ✅ **context-audit/scripts/audit.sh** - Self-detects and has fallback logic

### Examples to Fix

- ❌ **prd-manager/scripts/run.sh** - Uses `PRD_DIR=${PRD_DIR:-./prd-json}` (assumes cwd)
- ❌ **coderabbit workflows** - All use `./scripts/foo.sh` patterns
- ❌ **context7 scripts** - Use relative paths in usage examples

### Migration Checklist

For each skill script:

1. [ ] Add BASH_SOURCE self-detection at top
2. [ ] Replace `./` relative paths with `$SCRIPT_DIR/` or `$SKILL_DIR/`
3. [ ] Add project root detection if needed
4. [ ] Update SKILL.md examples to show correct usage
5. [ ] Test from different working directories

### Testing

Scripts MUST work when invoked from:
- Skill directory: `cd ~/.claude/skills/golem-powers/skill-name && scripts/run.sh`
- Project root: `cd ~/Gits/my-project && ~/.claude/skills/golem-powers/skill-name/scripts/run.sh`
- Subdirectory: `cd ~/Gits/my-project/src && ~/.claude/skills/golem-powers/skill-name/scripts/run.sh`

## Related

- See AUDIT-001 for the full analysis that led to this standard
- See MP-XXX for systematic migration of existing skills
