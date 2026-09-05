---
name: skills
description: "List golem skills/descriptions/grades/status. Triggers: list/search/show skills. NOT invoking skills."
---

# Skills Discovery

> List and search your installed Claude Code skills.

## Usage

When invoked via `/skills`, scan and display all available skills. If the user provides arguments like `--search <keyword>`, filter accordingly.

## Instructions

### Step 1: Scan Skills Directory

Run this to discover all skills:

```bash
#!/bin/bash
SKILLS_DIR="$HOME/.claude/skills"

echo "# Installed Skills"
echo ""

# Arrays to hold skills by category
declare -a domain_skills
declare -a infra_skills
declare -a custom_skills

# Function to extract description from a file
extract_desc() {
    local file="$1"
    # First try YAML frontmatter description
    if head -1 "$file" | grep -q '^---$'; then
        desc=$(awk '/^---$/{p++} p==1 && /^description:/{gsub(/^description: */, ""); print; exit}' "$file")
        if [[ -n "$desc" ]]; then
            echo "$desc"
            return
        fi
    fi
    # Fall back to first # header blockquote
    desc=$(awk '/^#/{found=1} found && /^>/{gsub(/^> */, ""); print; exit}' "$file")
    if [[ -n "$desc" ]]; then
        echo "$desc"
        return
    fi
    # Final fallback: first non-empty line after header
    awk '/^#/{found=1; next} found && NF{print; exit}' "$file"
}

# Function to count workflows in a directory
count_workflows() {
    local dir="$1"
    if [[ -d "$dir/workflows" ]]; then
        find "$dir/workflows" -name "*.md" 2>/dev/null | wc -l | tr -d ' '
    else
        echo "0"
    fi
}

# Function to determine source of a skill
get_source() {
    local path="$1"
    local resolved=$(readlink -f "$path" 2>/dev/null || echo "$path")

    if [[ "$resolved" == *"/golem-powers/"* ]] || [[ "$resolved" == *"/golems/skills/"* ]]; then
        echo "golem-powers"
    elif [[ "$resolved" == *"/superpowers/"* ]]; then
        echo "superpowers"
    elif [[ "$resolved" == *"/golems/"* ]] || [[ "$resolved" == *"/.config/golems/"* ]]; then
        echo "golem-powers"
    else
        echo "custom"
    fi
}

# Function to categorize skill
categorize_skill() {
    local name="$1"
    local desc="$2"

    # Infrastructure skills
    if echo "$name $desc" | grep -qiE 'git|github|commit|push|pr|1password|secret|vault|credential'; then
        echo "infra"
    # Domain skills (browser, PRD, etc)
    elif echo "$name $desc" | grep -qiE 'brave|browser|prd|product|archive|critique'; then
        echo "domain"
    else
        echo "custom"
    fi
}

# Scan for skills (handles namespaced skills like golem-powers/)
scan_skill_dir() {
    local dir="$1"
    local namespace="$2"

    for item in "$dir"/*; do
        [[ ! -e "$item" ]] && continue
        local name=$(basename "$item" .md)

        # Skip meta items
        [[ "$name" == "skills" ]] && continue

        if [[ -d "$item" ]]; then
            # Check if this is a skill directory (has SKILL.md)
            if [[ -f "$item/SKILL.md" ]]; then
                local full_name="${namespace}${name}"
                local desc=$(extract_desc "$item/SKILL.md")
                local workflows=$(count_workflows "$item")
                local source=$(get_source "$item")
                local category=$(categorize_skill "$name" "$desc")
                local entry="$full_name|$desc|$source|$workflows"

                case $category in
                    infra) infra_skills+=("$entry") ;;
                    domain) domain_skills+=("$entry") ;;
                    *) custom_skills+=("$entry") ;;
                esac
            else
                # This is a namespace directory (like golem-powers/), recurse
                scan_skill_dir "$item" "${name}:"
            fi
        elif [[ -f "$item" && "$item" == *.md ]]; then
            # Single-file skill
            local full_name="${namespace}${name}"
            local desc=$(extract_desc "$item")
            local source=$(get_source "$item")
            local category=$(categorize_skill "$name" "$desc")
            local entry="$full_name|$desc|$source|0"

            case $category in
                infra) infra_skills+=("$entry") ;;
                domain) domain_skills+=("$entry") ;;
                *) custom_skills+=("$entry") ;;
            esac
        fi
    done
}

# Start scanning from the root commands directory
scan_skill_dir "$SKILLS_DIR" ""

# Print function
print_skills() {
    local title="$1"
    shift
    local skills=("$@")

    if [[ ${#skills[@]} -gt 0 ]]; then
        echo "## $title"
        echo ""
        echo "| Skill | Description | Source | Workflows |"
        echo "|-------|-------------|--------|-----------|"
        for skill in "${skills[@]}"; do
            IFS='|' read -r name desc source workflows <<< "$skill"
            if [[ "$workflows" -gt 0 ]]; then
                echo "| **$name** | $desc | $source | $workflows |"
            else
                echo "| **$name** | $desc | $source | - |"
            fi
        done
        echo ""
    fi
}

# Output grouped by category
print_skills "Infrastructure" "${infra_skills[@]}"
print_skills "Domain" "${domain_skills[@]}"
print_skills "Custom" "${custom_skills[@]}"

echo "---"
echo "*Use \`/skills --search <keyword>\` to filter skills*"
```

### Step 2: Handle Search Filter

If the user invoked `/skills --search <keyword>`, modify the output to filter:

```bash
SEARCH="$1"  # e.g., "git" or "browser"

# In the scan loop, add filtering:
if [[ -n "$SEARCH" ]]; then
    if ! echo "$name $desc" | grep -qi "$SEARCH"; then
        continue  # Skip non-matching skills
    fi
fi
```

### Step 3: Present Results

After running the discovery script, present the results in a clean markdown table grouped by category:

1. **Infrastructure** - git, github, secrets, credentials
2. **Domain** - browser, PRD, specific tools
3. **Custom** - user-created skills

For each skill, show:
- **Name**: The skill command (e.g., `/pr-loop`)
- **Description**: From frontmatter or first paragraph
- **Source**: Where it comes from (golem-powers, superpowers, custom)
- **Workflows**: Count of sub-workflows for progressive disclosure skills

## Example Output

```
# Installed Skills

## Infrastructure

| Skill | Description | Source | Workflows |
|-------|-------------|--------|-----------|
| **github** | Git and GitHub CLI operations | golem-powers | 4 |
| **1password** | Secret management with 1Password | golem-powers | 5 |

## Domain

| Skill | Description | Source | Workflows |
|-------|-------------|--------|-----------|
| **brave** | Browser automation via brave-manager | golem-powers | - |
| **prd** | Generate Product Requirements Documents | golem-powers | - |
| **archive** | Archive completed PRD stories | golem-powers | - |

---
*Use `/skills --search <keyword>` to filter skills*
```

## Quick Reference

- `/skills` - List all installed skills
- `/skills --search git` - Find skills related to git
- `/skills --search secret` - Find skills for secrets management
