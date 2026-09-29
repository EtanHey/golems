# ═══════════════════════════════════════════════════════════════════
# GOLEM DISPATCH — R78 shell optimization
# Replaces 189 eval'd functions with thin wrappers + one dispatch.
# Startup cost: ~1ms (registering names) vs ~2min (eval'ing bodies)
# ═══════════════════════════════════════════════════════════════════

# Registry file path
: ${RALPH_REGISTRY_FILE:="$HOME/.config/ralphtools/registry.json"}

# Directory this file was sourced from. install-golem-dispatch.sh ships
# worktree-bootstrap.sh next to it, so -w launches can find it installed or not.
typeset -g _GOLEM_DISPATCH_DIR="${${(%):-%x}:A:h}"

# Thin bootstrap so `repoGolem` exists in shells that source golem-dispatch.zsh
# but not the full registry library. First call loads the real implementation.
if ! typeset -f repoGolem >/dev/null 2>&1; then
  function repoGolem() {
    local registry_lib="$HOME/.config/ralphtools/lib/ralph-registry.zsh"
    if [[ ! -f "$registry_lib" ]]; then
      echo "Error: repoGolem requires $registry_lib" >&2
      return 1
    fi

    unfunction repoGolem 2>/dev/null
    source "$registry_lib"

    if ! typeset -f repoGolem >/dev/null 2>&1; then
      echo "Error: repoGolem failed to load from $registry_lib" >&2
      return 1
    fi

    repoGolem "$@"
  }
fi

# ── Core dispatch: called by all thin wrappers ────────────────────


# Load every definition from the real location of this sourced facade.
# A missing module must stop sourcing before any wrappers are registered.
for _golem_module in core environment context agy flags claude codex-resume codex cursor gemini; do
  if [[ ! -f "${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh" ]]; then
    print -u2 -- "Missing dispatcher module: ${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh"
    return 1
  fi
  source "${_GOLEM_DISPATCH_DIR}/dispatch/${_golem_module}.zsh" || return 1
done
unset _golem_module
# Register all wrappers on source
_golem_register_wrappers
