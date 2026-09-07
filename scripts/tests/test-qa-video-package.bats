#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SKILL_DIR="$REPO_ROOT/skills/golem-powers/qa-video"
  SKILL_MD="$SKILL_DIR/SKILL.md"
}

local_references() {
  {
    sed -n 's/^execute:[[:space:]]*//p' "$SKILL_MD"
    grep -oE '\]\([^)]+' "$SKILL_MD" | sed 's/^](//'
    grep -oE '`(scripts|workflows|references)/[^`[:space:]]+`' "$SKILL_MD" \
      | tr -d '`'
  } | sed '/^$/d' | sort -u
}

@test "qa-video local references exist and scripts are executable" {
  failures=""

  while IFS= read -r relative_path; do
    case "$relative_path" in
      http://*|https://*|mailto:*|\#*) continue ;;
    esac

    target="$SKILL_DIR/$relative_path"
    if [ ! -f "$target" ]; then
      failures="${failures}missing: ${relative_path}"$'\n'
    elif [[ "$relative_path" == scripts/* ]] && [ ! -x "$target" ]; then
      failures="${failures}not executable: ${relative_path}"$'\n'
    fi
  done <<< "$(local_references)"

  [ -z "$failures" ] || {
    printf '%s' "$failures"
    return 1
  }
}
