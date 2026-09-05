#!/usr/bin/env bash
set -euo pipefail

# create-skill.sh - Generate golem-powers skill scaffolding
# Usage: create-skill.sh --name=<skill-name> --type=bash|typescript [--output=<path>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_OUTPUT="${SCRIPT_DIR}/../../../"

# Parse arguments
NAME=""
TYPE=""
OUTPUT="$DEFAULT_OUTPUT"

for arg in "$@"; do
    case $arg in
        --name=*)
            NAME="${arg#*=}"
            ;;
        --type=*)
            TYPE="${arg#*=}"
            ;;
        --output=*)
            OUTPUT="${arg#*=}"
            ;;
        --help|-h)
            echo "## create-skill.sh"
            echo ""
            echo "Generate golem-powers skill scaffolding."
            echo ""
            echo "### Usage"
            echo ""
            echo "\`\`\`bash"
            echo "create-skill.sh --name=<skill-name> --type=bash|typescript [--output=<path>]"
            echo "\`\`\`"
            echo ""
            echo "### Arguments"
            echo ""
            echo "- \`--name\`: Required. Skill name (lowercase, hyphenated)"
            echo "- \`--type\`: Required. Either \`bash\` or \`typescript\`"
            echo "- \`--output\`: Optional. Output directory (default: skills/golem-powers/)"
            echo ""
            echo "### Examples"
            echo ""
            echo "\`\`\`bash"
            echo "create-skill.sh --name=code-review --type=bash"
            echo "create-skill.sh --name=api-client --type=typescript --output=./my-skills/"
            echo "\`\`\`"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

# Validate arguments
if [[ -z "$NAME" ]]; then
    echo "Error: --name is required" >&2
    echo "Usage: create-skill.sh --name=<skill-name> --type=bash|typescript" >&2
    exit 1
fi

if [[ -z "$TYPE" ]]; then
    echo "Error: --type is required (bash or typescript)" >&2
    exit 1
fi

if [[ "$TYPE" != "bash" && "$TYPE" != "typescript" ]]; then
    echo "Error: --type must be 'bash' or 'typescript'" >&2
    exit 1
fi

# Create skill directory
SKILL_DIR="${OUTPUT}/${NAME}"

if [[ -d "$SKILL_DIR" ]]; then
    echo "Error: Skill directory already exists: $SKILL_DIR" >&2
    exit 1
fi

mkdir -p "$SKILL_DIR/scripts"

# Create SKILL.md with appropriate frontmatter
if [[ "$TYPE" == "bash" ]]; then
    cat > "$SKILL_DIR/SKILL.md" << 'SKILLMD'
---
name: SKILL_NAME_PLACEHOLDER
description: TODO - Describe when to use this skill
execute: scripts/default.sh
---

# SKILL_NAME_PLACEHOLDER

> TODO - Brief description of what this skill does.

## Usage

This skill automatically executes `scripts/default.sh` when loaded.

## What It Does

1. TODO - Document step 1
2. TODO - Document step 2
3. TODO - Document step 3

## Output

The script outputs Markdown that Claude can parse and act on.

## Requirements

- TODO - List any dependencies or requirements
SKILLMD
    # Replace placeholder with actual name
    perl -pi -e "s/SKILL_NAME_PLACEHOLDER/${NAME}/g" "$SKILL_DIR/SKILL.md"

    # Create default.sh
    cat > "$SKILL_DIR/scripts/default.sh" << 'DEFAULTSH'
#!/usr/bin/env bash
set -euo pipefail

# default.sh - Main executable for this skill
# This script is auto-executed when the skill is loaded

echo "## SKILL_NAME_PLACEHOLDER"
echo ""
echo "Skill executed successfully!"
echo ""
echo "### TODO"
echo ""
echo "- Replace this with your skill logic"
echo "- Output Markdown for Claude to parse"
echo "- Exit 0 on success, non-zero on failure"
DEFAULTSH
    perl -pi -e "s/SKILL_NAME_PLACEHOLDER/${NAME}/g" "$SKILL_DIR/scripts/default.sh"
    chmod +x "$SKILL_DIR/scripts/default.sh"

else
    # TypeScript pattern
    mkdir -p "$SKILL_DIR/src"

    cat > "$SKILL_DIR/SKILL.md" << 'SKILLMD'
---
name: SKILL_NAME_PLACEHOLDER
description: TODO - Describe when to use this skill
execute: scripts/run.sh --action=default
---

# SKILL_NAME_PLACEHOLDER

> TODO - Brief description of what this skill does.

## Usage

This skill automatically executes `scripts/run.sh --action=default` when loaded.

## Actions

| Action | Description |
|--------|-------------|
| `--action=default` | Main skill behavior |
| `--action=verify` | Verify something |
| `--action=list` | List something |

## What It Does

1. TODO - Document step 1
2. TODO - Document step 2
3. TODO - Document step 3

## Output

The script outputs Markdown that Claude can parse and act on.

## Requirements

- Bun runtime (`brew install oven-sh/bun/bun`)
- Run `bun install` in skill directory if dependencies needed
SKILLMD
    perl -pi -e "s/SKILL_NAME_PLACEHOLDER/${NAME}/g" "$SKILL_DIR/SKILL.md"

    # Create run.sh wrapper
    cat > "$SKILL_DIR/scripts/run.sh" << 'RUNSH'
#!/usr/bin/env bash
set -euo pipefail

# run.sh - Wrapper for TypeScript skill
# Usage: run.sh --action=xxx [--env=dev|prod]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Run bun with the TypeScript source
bun run src/index.ts "$@"
RUNSH
    chmod +x "$SKILL_DIR/scripts/run.sh"

    # Create index.ts
    cat > "$SKILL_DIR/src/index.ts" << 'INDEXTS'
// index.ts - Main TypeScript entry point for this skill
// Usage: bun run src/index.ts --action=default [--env=dev|prod]

const args = process.argv.slice(2);

// Parse --action flag
const actionArg = args.find((a) => a.startsWith("--action="));
const action = actionArg?.split("=")[1] || "default";

// Parse --env flag
const envArg = args.find((a) => a.startsWith("--env="));
const env = envArg?.split("=")[1] || "dev";

// Main logic
async function main() {
  console.log("## SKILL_NAME_PLACEHOLDER");
  console.log("");
  console.log(`Action: \`${action}\``);
  console.log(`Environment: \`${env}\``);
  console.log("");

  switch (action) {
    case "default":
      console.log("### Default Action");
      console.log("");
      console.log("TODO - Implement your skill logic here.");
      console.log("");
      console.log("- Replace this with actual functionality");
      console.log("- Output Markdown for Claude to parse");
      console.log("- Use process.exit(1) for errors");
      break;

    case "verify":
      console.log("### Verify Action");
      console.log("");
      console.log("TODO - Implement verification logic.");
      break;

    case "list":
      console.log("### List Action");
      console.log("");
      console.log("TODO - Implement list logic.");
      break;

    default:
      console.error(`Unknown action: ${action}`);
      console.error("Available actions: default, verify, list");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
INDEXTS
    perl -pi -e "s/SKILL_NAME_PLACEHOLDER/${NAME}/g" "$SKILL_DIR/src/index.ts"

    # Create package.json
    cat > "$SKILL_DIR/package.json" << PACKAGEJSON
{
  "name": "${NAME}",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
PACKAGEJSON
fi

# Output success
echo "## Skill Created"
echo ""
echo "Created \`${NAME}\` skill at:"
echo ""
echo "\`\`\`"
echo "$SKILL_DIR"
echo "\`\`\`"
echo ""
echo "### Structure"
echo ""
if [[ "$TYPE" == "bash" ]]; then
    echo "\`\`\`"
    echo "${NAME}/"
    echo "├── SKILL.md"
    echo "└── scripts/"
    echo "    └── default.sh"
    echo "\`\`\`"
else
    echo "\`\`\`"
    echo "${NAME}/"
    echo "├── SKILL.md"
    echo "├── package.json"
    echo "├── scripts/"
    echo "│   └── run.sh"
    echo "└── src/"
    echo "    └── index.ts"
    echo "\`\`\`"
fi
echo ""
echo "### Next Steps"
echo ""
echo "1. Edit \`SKILL.md\` - Update name, description, and documentation"
echo "2. Edit the script(s) - Implement your skill logic"
if [[ "$TYPE" == "typescript" ]]; then
    echo "3. Run \`bun install\` in the skill directory if you add dependencies"
fi
echo ""
echo "### Test It"
echo ""
if [[ "$TYPE" == "bash" ]]; then
    echo "\`\`\`bash"
    echo "bash ${SKILL_DIR}/scripts/default.sh"
    echo "\`\`\`"
else
    echo "\`\`\`bash"
    echo "bash ${SKILL_DIR}/scripts/run.sh --action=default"
    echo "\`\`\`"
fi
