_golem_parse_unified_flags() {
  # Parse the unified -s/-c/-m/-p/-u/--web flags shared across CLIs.
  # Sets variables in the CALLER's scope (no subshell).
  local -a _parsed_args=()
  _flag_skip=false
  _flag_continue=false
  _flag_update=false
  _flag_web=false
  _flag_headless=false
  _flag_model=""
  _flag_effort=""
  _flag_sonnet=false
  _flag_headless_prompt=""
  _flag_notify_mode=""
  _flag_worktree=""
  _flag_worker=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -s|--skip-permissions) _flag_skip=true; shift ;;
      -c|--continue) _flag_continue=true; shift ;;
      -u|--update) _flag_update=true; shift ;;
      --web) _flag_web=true; shift ;;
      -m|--model)
        if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
          echo "Error: $1 requires a model name" >&2
          return 2
        fi
        _flag_model="$2"; shift 2 ;;
      -S|--sonnet) _flag_sonnet=true; shift ;;
      -E|--effort)
        if [[ -z "${2:-}" ]]; then
          print -u2 -r -- "repoGolem: --effort requires a value (low|medium|high|xhigh|max)"; return 2
        fi
        _flag_effort="$2"; shift 2 ;;
      -p|--print)
        _flag_headless=true
        if [[ -n "$2" && "$2" != -* ]]; then _flag_headless_prompt="$2"; shift; fi
        shift ;;
      -w|--worktree)
        if [[ -n "$2" && "$2" != -* ]]; then _flag_worktree="${2/#\~/$HOME}"; shift 2
        else echo "Error: $1 requires a path" >&2; return 2; fi ;;
      --worker) _flag_worker=true; shift ;;
      -QN|--quiet-notify) _flag_notify_mode="quiet"; shift ;;
      -SN|--simple-notify) _flag_notify_mode="simple"; shift ;;
      -VN|--verbose-notify) _flag_notify_mode="verbose"; shift ;;
      *) _parsed_args+=("$1"); shift ;;
    esac
  done
  _extra_args=("${_parsed_args[@]}")
}

_golem_print_codex_help() {
  print -r -- "Codex launcher options:"
  print -r -- "  -E, --effort <value>   low, medium, high, xhigh, max, ultra"
  print -r -- "                         prompted/worker boots require -E or GOLEM_EFFORT"
  print -r -- "                         choose per plan phase (see /agent-routing); bare interactive uses Codex config"
  print -r -- "      -- <raw args>      requires effort too: raw Codex args may carry a prompt"
  print -r -- "      --lead             lead seat: keeps codex_apps connectors and browser-tools"
  print -r -- "                         (other agent-shaped launches keep Locals T3code and read-only Drive)"
  print -r -- "      --scan             codex-security scan seat: workspace-write, no approvals, worker strips,"
  print -r -- "                         codex.security model, per-launch Deep Scan cost cap"
  print -r -- "  -m, --model <name>     explicit model override"
  print -r -- "  -s, --skip-permissions compatibility no-op (has no effect)"
  print -r -- "  -c, --continue         resume the last session"
  print -r -- "  -p, --print [prompt]   run a headless one-shot"
  print -r -- "  -w, --worktree <existing path>  launch from a pre-created worktree"
  print -r -- "      --worker          launch plain Codex without registry persona context"
  print -r -- "  -h, --help             show this help"
}

_golem_parse_codex_flags() {
  local -a _parsed_args=()
  _flag_codex_effort=""
  _flag_codex_effort_explicit=false
  _flag_codex_help=false
  _flag_codex_worker=false
  _flag_codex_lead=false
  _flag_codex_scan=false
  _codex_passthrough_args=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --) shift; _codex_passthrough_args=("$@"); break ;;
      -E|--effort)
        local effort_flag="$1"
        if [[ -z "${2:-}" || "${2:-}" == -* ]]; then
          echo "Error: ${effort_flag} requires one of: low, medium, high, xhigh, max, ultra" >&2
          return 2
        fi
        case "$2" in
          low|medium|high|xhigh|max|ultra)
            _flag_codex_effort="$2"
            _flag_codex_effort_explicit=true ;;
          *)
            echo "Error: Invalid Codex effort: $2 (expected: low, medium, high, xhigh, max, ultra)" >&2
            return 2 ;;
        esac
        shift 2 ;;
      --worker) _flag_codex_worker=true; shift ;;
      --lead) _flag_codex_lead=true; shift ;;
      --scan) _flag_codex_scan=true; shift ;;
      -h|--help) _flag_codex_help=true; shift ;;
      *) _parsed_args+=("$1"); shift ;;
    esac
  done
  _codex_extra_args=("${_parsed_args[@]}")
}

_golem_refuse_agent_model_override() {
  local launcher_name="$1"
  [[ -z "$_flag_model" ]] && return 0
  $_flag_headless && return 0
  [[ "${REPOGOLEM_ALLOW_MODEL:-}" == "1" ]] && return 0

  echo "Error: ${launcher_name} refuses -m/--model for agent sessions." >&2
  echo "repoGolem bare-launcher law: use the bare launcher so the Opus 1M pin is preserved." >&2
  echo "For scripted non-agent one-shots, use -p; for explicit automation overrides, set REPOGOLEM_ALLOW_MODEL=1." >&2
  return 2
}

_golem_refuse_claude_sonnet_full_pane() {
  $_flag_headless && return 0

  local model="$_flag_model"
  $_flag_sonnet && model="sonnet"
  [[ "${(L)model}" != *sonnet* ]] && return 0

  echo "Error: Claude launchers refuse Sonnet-tier models for full panes." >&2
  echo "Use Opus for full panes; Sonnet remains available for headless/subagent work." >&2
  return 2
}

_golem_claude_resolve_model() {
  # Map short Claude aliases to exact model strings; unknown names pass through verbatim.
  # `fable` tracks the CURRENT Fable release (not a frozen id): bump the target on each
  # Fable release so `-m fable` stays a one-flag boot. Fable is per-invocation only
  # (canon rule 5) - the default pin below stays on Opus.
  case "${1:-}" in
    fable|fable-5.1) print -r -- "claude-fable-5-1[1m]" ;;
    *)               print -r -- "$1" ;;
  esac
}

# ── Claude launcher ───────────────────────────────────────────────
