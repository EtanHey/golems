#!/bin/bash
# Generate Test Plan - Analyzes git diff and generates a manual testing checklist
set -euo pipefail

# REQUIRED: Self-detect script location (works from any cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

# Default values
BASE_BRANCH="main"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --base)
            BASE_BRANCH="$2"
            shift 2
            ;;
        --base=*)
            BASE_BRANCH="${1#*=}"
            shift
            ;;
        -h|--help)
            echo "Usage: generate.sh [--base <branch>]"
            echo ""
            echo "Options:"
            echo "  --base <branch>  Base branch to diff against (default: main)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Get changed files
if ! changed_files=$(git diff --name-only "${BASE_BRANCH}...HEAD" 2>/dev/null); then
    # Fallback: try without the three-dot syntax
    if ! changed_files=$(git diff --name-only "${BASE_BRANCH}" HEAD 2>/dev/null); then
        echo "## Test Plan"
        echo ""
        echo "**Error**: Could not determine changes against base branch '${BASE_BRANCH}'."
        echo ""
        echo "Possible causes:"
        echo "- Base branch '${BASE_BRANCH}' doesn't exist"
        echo "- No commits on current branch"
        echo "- Not in a git repository"
        exit 1
    fi
fi

# Check if there are any changes
if [[ -z "$changed_files" ]]; then
    echo "## Test Plan"
    echo ""
    echo "**No changes detected** against \`${BASE_BRANCH}\`."
    echo ""
    echo "Either:"
    echo "- The current branch is identical to ${BASE_BRANCH}"
    echo "- Try specifying a different base branch with \`--base <branch>\`"
    exit 0
fi

# Categorize files
declare -a ui_files=()
declare -a api_files=()
declare -a db_files=()
declare -a config_files=()
declare -a test_files=()
declare -a other_files=()

while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    # Categorize based on path and extension
    # Check database/schema patterns first (more specific)
    if [[ "$file" == *"convex/"* ]] || [[ "$file" == *"/migrations/"* ]] || [[ "$file" == *"/schema/"* ]] || [[ "$file" == *"/prisma/"* ]] || [[ "$file" == *"/drizzle/"* ]] || [[ "$file" == *.sql ]]; then
        db_files+=("$file")
    # Check test files
    elif [[ "$file" == *".test."* ]] || [[ "$file" == *".spec."* ]] || [[ "$file" == *"__tests__"* ]]; then
        test_files+=("$file")
    # Check config files
    elif [[ "$file" == *.json ]] || [[ "$file" == *.yaml ]] || [[ "$file" == *.yml ]] || [[ "$file" == *.toml ]] || [[ "$file" == *.env* ]] || [[ "$file" == *".config."* ]] || [[ "$file" == Dockerfile* ]] || [[ "$file" == docker-compose* ]]; then
        config_files+=("$file")
    # Check UI files
    elif [[ "$file" == *.tsx ]] || [[ "$file" == *.jsx ]] || [[ "$file" == *.vue ]] || [[ "$file" == *.svelte ]] || [[ "$file" == *.css ]] || [[ "$file" == *.scss ]] || [[ "$file" == *.sass ]] || [[ "$file" == *.less ]] || [[ "$file" == *.styled.ts ]] || [[ "$file" == *.styles.ts ]]; then
        if [[ "$file" == *"/api/"* ]] || [[ "$file" == *"pages/api"* ]] || [[ "$file" == *"app/api"* ]]; then
            api_files+=("$file")
        else
            ui_files+=("$file")
        fi
    # Check API/Backend files
    elif [[ "$file" == *.ts ]] || [[ "$file" == *.js ]]; then
        if [[ "$file" == *"/api/"* ]] || [[ "$file" == *"pages/api"* ]] || [[ "$file" == *"app/api"* ]] || [[ "$file" == *"server/"* ]] || [[ "$file" == *"backend/"* ]]; then
            api_files+=("$file")
        elif [[ "$file" == *"config"* ]]; then
            config_files+=("$file")
        else
            other_files+=("$file")
        fi
    # Everything else
    else
        other_files+=("$file")
    fi
done <<< "$changed_files"

# Helper function to extract component/feature name from file path
get_feature_name() {
    local file="$1"
    local name

    # Extract the meaningful part of the path
    name=$(basename "$file" | sed -E 's/\.(tsx?|jsx?|vue|svelte|css|scss)$//' | sed -E 's/\.(test|spec|stories)$//')

    # Convert kebab-case and snake_case to Title Case
    echo "$name" | sed -E 's/[-_]/ /g' | awk '{for(i=1;i<=NF;i++)sub(/./,toupper(substr($i,1,1)),$i)}1'
}

# Helper function to get test description based on file
get_test_description() {
    local file="$1"
    local filename
    filename=$(basename "$file")

    case "$file" in
        *"/components/"*)
            echo "Verify component renders correctly and interactions work"
            ;;
        *"/pages/"*|*"/app/"*)
            echo "Verify page loads without errors and displays expected content"
            ;;
        *"/hooks/"*)
            echo "Verify hook behavior in components that use it"
            ;;
        *"/utils/"*|*"/lib/"*|*"/helpers/"*)
            echo "Verify utility functions work correctly in consuming code"
            ;;
        *"/api/"*)
            echo "Verify endpoint returns expected response shape and status codes"
            ;;
        *"/services/"*)
            echo "Verify service integrations work end-to-end"
            ;;
        *)
            echo "Verify functionality works as expected"
            ;;
    esac
}

# Output the test plan
echo "## Test Plan"
echo ""
echo "Generated from diff against \`${BASE_BRANCH}\`"
echo ""

# UI Components section
if [[ ${#ui_files[@]} -gt 0 ]]; then
    echo "### UI Components"
    echo ""
    for file in "${ui_files[@]}"; do
        feature=$(get_feature_name "$file")
        desc=$(get_test_description "$file")
        echo "- [ ] Test: **${feature}** - ${desc}"
        echo "  - File: \`${file}\`"
    done
    echo ""
    echo "#### UI Regression Checks"
    echo "- [ ] Test: No visual regressions in modified components"
    echo "- [ ] Test: Mobile responsive layout works correctly"
    echo "- [ ] Test: Dark mode (if applicable) displays correctly"
    echo ""
fi

# API section
if [[ ${#api_files[@]} -gt 0 ]]; then
    echo "### API Endpoints"
    echo ""
    for file in "${api_files[@]}"; do
        feature=$(get_feature_name "$file")
        echo "- [ ] Test: **${feature}** - Verify endpoint returns expected response"
        echo "  - File: \`${file}\`"
    done
    echo ""
    echo "#### API Regression Checks"
    echo "- [ ] Test: Error responses have correct status codes"
    echo "- [ ] Test: Authentication/authorization works correctly"
    echo "- [ ] Test: Request validation rejects invalid input"
    echo ""
fi

# Database section
if [[ ${#db_files[@]} -gt 0 ]]; then
    echo "### Database/Schema"
    echo ""
    for file in "${db_files[@]}"; do
        feature=$(get_feature_name "$file")
        echo "- [ ] Test: **${feature}** - Verify schema changes apply correctly"
        echo "  - File: \`${file}\`"
    done
    echo ""
    echo "#### Database Regression Checks"
    echo "- [ ] Test: Migrations run without errors"
    echo "- [ ] Test: Existing data remains intact after migration"
    echo "- [ ] Test: Rollback works if needed"
    echo ""
fi

# Config section
if [[ ${#config_files[@]} -gt 0 ]]; then
    echo "### Configuration"
    echo ""
    for file in "${config_files[@]}"; do
        filename=$(basename "$file")
        echo "- [ ] Test: **${filename}** - Verify config changes don't break existing functionality"
        echo "  - File: \`${file}\`"
    done
    echo ""
    echo "#### Config Regression Checks"
    echo "- [ ] Test: Environment variables are documented"
    echo "- [ ] Test: Config changes work in all environments (dev/staging/prod)"
    echo ""
fi

# Other files section
if [[ ${#other_files[@]} -gt 0 ]]; then
    echo "### Other Changes"
    echo ""
    for file in "${other_files[@]}"; do
        feature=$(get_feature_name "$file")
        echo "- [ ] Test: **${feature}** - Verify changes work as expected"
        echo "  - File: \`${file}\`"
    done
    echo ""
fi

# General section
echo "### General"
echo ""
echo "- [ ] Test: No console errors during testing"
echo "- [ ] Test: No TypeScript/build errors (\`npm run build\` or \`bun run build\`)"
echo "- [ ] Test: All existing tests pass (\`npm test\` or \`bun test\`)"
if [[ ${#test_files[@]} -gt 0 ]]; then
    echo "- [ ] Test: New/modified tests pass and cover the changes"
fi
echo ""
echo "---"
echo ""
echo "**Files changed:** ${#ui_files[@]} UI, ${#api_files[@]} API, ${#db_files[@]} DB, ${#config_files[@]} Config, ${#other_files[@]} Other"
