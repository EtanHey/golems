# Short-lived launch files (persona context, agy MCP merges, notify config)
# stage HERE, never in a shared /tmp. Two reasons:
#   1. The fleet's TMP-BLOCK guard (skills/golem-powers/tmp-block) denies agents
#      every /tmp write, fail-closed. A launcher that staged through /tmp could
#      not be driven by an agent at all — backlog #24's ruling is that the
#      LAUNCHER moves and the guard stays fail-closed.
#   2. These files carry MCP config and per-seat context. /tmp is shared and
#      world-readable; this dir is 0700 and the files inside it are 0600.
# Cleanup is the same two-layer shape the Codex profile staging already uses
# below: every call site removes its own file on the way out, and each launch
# reaps entries an interrupted earlier launch orphaned. The 24h guard keeps the
# reaper off a concurrent launch's live files.
# (A `trap`-based sweep cannot replace the reaper here: this file is sourced
# into the user's interactive shell, so a trap set outside `localtraps` would
# outlive the launch and fire on the shell itself.)
_golem_staging_dir() {
  local project_name="${1:-project}"
  local safe="${project_name//[^A-Za-z0-9_-]/-}"
  [[ -z "$safe" ]] && safe="project"

  local base
  if [[ -n "${XDG_RUNTIME_DIR:-}" ]]; then
    base="${XDG_RUNTIME_DIR}/repogolem"
  else
    base="${HOME}/.cache/repogolem"
  fi

  local dir="${base}/${safe}"
  mkdir -p "$dir" 2>/dev/null || return 1
  chmod 700 "$base" "$dir" 2>/dev/null
  # (no (#cN) here: that needs EXTENDED_GLOB, which this file does not set)
  rm -f "$dir"/*(N.mh+24) 2>/dev/null

  print -r -- "$dir"
}

_golem_inject_agent_context() {
  # Personas are a LEAD affordance. A worker seat gets its brief, not a boot ritual.
  # Gates all three CLIs (codex/cursor/gemini) at the single shared injection point;
  # _golem_launch_codex's own worker_mode check remains as belt-and-braces.
  [[ "${GOLEM_ROLE:-}" == "worker" ]] && return 0
  local project_name="$1" cli_name="$2"
  local registry="$RALPH_REGISTRY_FILE"
  [[ ! -f "$registry" ]] && return 0

  local agent_name
  agent_name=$(jq -r --arg p "$project_name" '.projects[$p].agent // ""' "$registry" 2>/dev/null)
  [[ -z "$agent_name" || "$agent_name" == "null" ]] && return 0

  local agent_file="$HOME/.claude/agents/${agent_name}.md"
  [[ ! -f "$agent_file" ]] && return 0

  local safe_project_name="${project_name//[^a-zA-Z0-9_-]/}"
  [[ -z "$safe_project_name" ]] && safe_project_name="project"

  local staging_dir
  staging_dir=$(_golem_staging_dir "$project_name") || return 0

  local context_file
  context_file=$(umask 077; mktemp "${staging_dir}/repogolem-${cli_name}-${safe_project_name}-agent.XXXXXX") || return 0
  chmod 600 "$context_file" 2>/dev/null
  if ! awk '
    NR == 1 && $0 == "---" { in_frontmatter = 1; next }
    in_frontmatter && $0 == "---" {
      in_frontmatter = 0
      if (initial_prompt != "") {
        print "## Initial prompt from agent frontmatter"
        printf "%s", initial_prompt
        print ""
      }
      next
    }
    in_frontmatter {
      if ($0 ~ /^initialPrompt:[[:space:]]*\|[[:space:]]*$/) {
        capture_initial = 1
        next
      }
      if (capture_initial && $0 ~ /^[A-Za-z_][A-Za-z0-9_-]*:/) {
        capture_initial = 0
      }
      if (capture_initial) {
        line = $0
        sub(/^  /, "", line)
        initial_prompt = initial_prompt line "\n"
      }
      next
    }
    !in_frontmatter { print }
  ' "$agent_file" > "$context_file"; then
    rm -f "$context_file" 2>/dev/null
    return 0
  fi

  print -r -- "$context_file"
}

_golem_build_agent_prompt() {
  local context_file="$1" user_prompt="${2:-}"
  [[ ! -f "$context_file" ]] && return 1

  local context_body
  context_body=$(<"$context_file")
  local ambiguity_gate
  ambiguity_gate='## BrainLayer-first ambiguity gate

For ambiguous proper nouns, named people, private voices, repo-local entities, projects, and artifacts:
1. Search or use BrainLayer/user/project context before public web or popularity inference.
2. If the task depends on a named person, voice, or private entity and BrainLayer is unavailable, stop with BLOCKED_BRAINLAYER_UNAVAILABLE instead of guessing.
3. If the prompt names a person only by first name in a private voice/person task, resolve them from BrainLayer context and existing voice artifacts unless verified context says otherwise.'

  if [[ -n "$user_prompt" ]]; then
    print -r -- "Adopt the following launcher agent context for this session. Treat it as the active agent protocol for this non-Claude CLI.

<agent_context>
${context_body}
</agent_context>

${ambiguity_gate}

User prompt:
${user_prompt}"
  else
    print -r -- "Adopt the following launcher agent context for this session. Treat it as the active agent protocol for this non-Claude CLI.

<agent_context>
${context_body}
</agent_context>

${ambiguity_gate}"
  fi
}

_golem_build_worker_prompt() {
  local user_prompt="${3:-}"
  [[ -n "$user_prompt" ]] && print -r -- "$user_prompt"
  return 0
}

_golem_cleanup_agent_context() {
  local context_file="${1:-}"
  [[ -n "$context_file" && -f "$context_file" ]] && rm -f "$context_file" 2>/dev/null
}
