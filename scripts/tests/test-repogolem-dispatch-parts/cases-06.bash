function split_case_097() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents" "$TMPDIR_/bin"
    cat > "$fake_home/.claude/agents/test-agent.md" <<'AGENT'
---
name: test-agent
description: Test agent context.
---

# test-agent

Use repository context.
AGENT

    jq '.projects.testrepo.agent = "test-agent" | .projects.testrepo.mcps = ["brainlayer"]' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-agent.json"
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "LIVE_TMP=$(ls -A /tmp 2>/dev/null | grep -E '^(repogolem-|\.claude_notify_config_)' | tr '\n' ' ')"
print -r -- "LIVE_STAGING=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr '\n' ' ')"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    local before_tmp; before_tmp="$(snapshot_tmp_staging_entries)"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"
      unset XDG_RUNTIME_DIR

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini -s "stage check"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    # The persona context file is live while agy runs and must be staged outside /tmp.
    grep -E -q -- 'LIVE_STAGING=.*repogolem-gemini-testrepo-agent\.' <<< "$output"
    refute_contains "repogolem-gemini-testrepo-agent." \
      "$(grep -E '^LIVE_TMP=' <<< "$output")" \
      "persona context must not be staged in a shared /tmp"

    [ "$(snapshot_tmp_staging_entries)" = "$before_tmp" ]
}

function split_case_098() {
    [ -f "$SOURCE_DISPATCHER" ]

    run grep -n -E '(mktemp|>)[^|]*"?/tmp/' "$SOURCE_DISPATCHER"
    if [ "$status" -eq 0 ]; then
        echo "launcher still stages through /tmp:" >&2
        echo "$output" >&2
        return 1
    fi
}

function split_case_099() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home" xdg="$TMPDIR_/xdg-runtime"
    mkdir -p "$fake_home" "$xdg"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export XDG_RUNTIME_DIR="$3"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() {
        print -r -- "LIVE_STAGING=$(ls -A "$XDG_RUNTIME_DIR/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
      }

      source "$4"
      _golem_register_wrappers
      testrepoClaude -s -QN
    ' _ "$fake_home" "$REGISTRY_FILE" "$xdg" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -E -q -- 'LIVE_STAGING=.*\.claude_notify_config_testrepo\.json' <<< "$output"
    [ ! -d "$fake_home/.cache/repogolem" ]
}

function split_case_100() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"

    # zsh tears function locals down BEFORE a localtraps EXIT trap runs, so an
    # EXIT trap that reads a local both fails to clean up and — under nounset —
    # prints `parameter not set` on every launch. Caught by the W23 spawn proof.
    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      unset XDG_RUNTIME_DIR
      setopt nounset

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() { print -r -- "CLAUDE-RAN"; }

      source "$3"
      _golem_register_wrappers
      testrepoClaude -s -QN
    ' _ "$fake_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CLAUDE-RAN" <<< "$output"
    refute_contains "parameter not set" "$output" \
      "notify cleanup must not read a torn-down local under nounset"
}

function split_case_101() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"

    # An INT trap DOES see the local (it fires while the function is still on
    # the stack), which is the whole point of the trap: an interrupted launch
    # must not leave its notify config behind.
    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      unset XDG_RUNTIME_DIR

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      # Stands in for a claude session the user Ctrl-Cs.
      function claude() {
        print -r -- "STAGED_BEFORE_INT=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
        kill -INT $$
        sleep 1
      }

      source "$3"
      _golem_register_wrappers
      testrepoClaude -s -QN
      print -r -- "STAGED_AFTER_INT=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
    ' _ "$fake_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    grep -E -q -- 'STAGED_BEFORE_INT=.*\.claude_notify_config_testrepo\.json' <<< "$output"
    grep -E -q -- 'STAGED_AFTER_INT= *$' <<< "$output"
}

function split_case_102() {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      source "$1"
      for alias in flash flash-high flash-med flash-medium flash-low; do
        print -r -- "$alias=$(_golem_agy_resolve_model "$alias")"
      done
    ' _ "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -x -q -- "flash=Gemini 3.8 Flash (High)" <<< "$output"
    grep -F -x -q -- "flash-high=Gemini 3.8 Flash (High)" <<< "$output"
    grep -F -x -q -- "flash-med=Gemini 3.8 Flash (Medium)" <<< "$output"
    grep -F -x -q -- "flash-medium=Gemini 3.8 Flash (Medium)" <<< "$output"
    grep -F -x -q -- "flash-low=Gemini 3.8 Flash (Low)" <<< "$output"
    ! grep -F -q -- "Gemini 3.5 Flash" <<< "$output"
}

# BSD mktemp (macOS) only substitutes TRAILING X's: `name.XXXXXX.json` is
# created literally, so a second concurrent launch for the same project hits
# `mkstemp failed ... File exists` (#268). GNU mktemp substitutes the X run
# wherever it sits, so the shim below reproduces BSD semantics on Linux CI.
# The barrier holds every call until both launches have attempted that
# template, forcing the overlap the real race depends on.
BSD_MKTEMP_SHIM='function mktemp() {
        local tmpl="${@[-1]}"
        print -r -- "$tmpl" >> "$MKTEMP_ATTEMPTS"
        local -i tries=0
        while (( $(grep -c -x -F -- "$tmpl" "$MKTEMP_ATTEMPTS") < 2 && tries < 60 )); do
          sleep 0.05
          (( tries += 1 ))
        done
        local out
        if [[ "$tmpl" == *XXX ]]; then
          out=$(command mktemp "$tmpl") || return 1
        else
          out="$tmpl"
          if ! ( set -o noclobber; : > "$out" ) 2>/dev/null; then
            print -u2 -- "mktemp: mkstemp failed on ${tmpl}: File exists"
            return 1
          fi
        fi
        print -r -- "$out" >> "$MKTEMP_CREATED"
        print -r -- "$out"
      }'

function split_case_103() {
    set_agy_registry_servers '{"local":{"command":"true"}}'
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home" xdg="$TMPDIR_/xdg-runtime"
    mkdir -p "$fake_home" "$xdg"
    export MKTEMP_ATTEMPTS="$TMPDIR_/mktemp-attempts" MKTEMP_CREATED="$TMPDIR_/mktemp-created"
    : > "$MKTEMP_ATTEMPTS"
    : > "$MKTEMP_CREATED"
    printf '%s\n' '{"mcpServers":{"local":{"command":"true"}}}' > "$PROJECT_DIR/.mcp.json"

    run env RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c '
      export HOME="$1" XDG_RUNTIME_DIR="$2"
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      '"$BSD_MKTEMP_SHIM"'
      source "$3"
      _golem_sync_agy_workspace testrepo "$4" & local pid_a=$!
      _golem_sync_agy_workspace testrepo "$4" & local pid_b=$!
      wait $pid_a; print -r -- "RUN_A=$?"
      wait $pid_b; print -r -- "RUN_B=$?"
    ' _ "$fake_home" "$xdg" "$SOURCE_DISPATCHER" "$PROJECT_DIR"

    [ "$status" -eq 0 ]
    grep -F -x -q -- "RUN_A=0" <<< "$output"
    grep -F -x -q -- "RUN_B=0" <<< "$output"
    ! grep -F -q -- "mkstemp failed" <<< "$output" || false

    # One same-directory atomic temp per target, four in all; none shared.
    [ "$(wc -l < "$MKTEMP_CREATED")" -eq 4 ]
    [ -z "$(sort "$MKTEMP_CREATED" | uniq -d)" ]
    ! grep -F -q -- "XXXXXX" "$MKTEMP_CREATED" || false
    [ -z "$(find "$xdg" "$fake_home" "$PROJECT_DIR" -name '*XXXXXX*' -print)" ]

    jq -e '.mcpServers.local.command == "true"' "$PROJECT_DIR/.agents/mcp_config.json"
    jq -e '.mcpServers.local.command == "true"' "$fake_home/.gemini/config/mcp_config.json"
}

function split_case_104() {
    [ -f "$SOURCE_DISPATCHER" ]

    # BSD mktemp leaves X's that are followed by anything else unsubstituted.
    run grep -n -E 'mktemp[^)]*XXX[^X"]' "$SOURCE_DISPATCHER"
    if [ "$status" -eq 0 ]; then
        echo "mktemp templates with a suffix after the X's:" >&2
        echo "$output" >&2
        return 1
    fi
}

# ── --worker is the one worker signal: it owns GOLEM_ROLE ──────────
#
# cmuxlayer's spawn_agent used to type GOLEM_ROLE=worker in front of non-Claude
# worker launchers. The dispatcher owns it now: --worker sets it for the call.
#
# The launched stub reports GOLEM_ROLE twice: as the launcher's shell sees it,
# and as a real child process inherits it (the agent CLI is a child process).
# After the launcher returns, the caller's shell must hold what it held before.
run_worker_role_launch() {
    local preset="$1"; shift
    run zsh -f -c '
      unset GOLEM_ROLE
      [ -n "$3" ] && export GOLEM_ROLE="$3"
      export RALPH_REGISTRY_FILE="$1"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _role_probe() {
        print -r -- "$1_ROLE_SHELL=${GOLEM_ROLE-unset}"
        print -r -- "$1_ROLE_CHILD=$(command env | sed -n "s/^GOLEM_ROLE=//p")"
        print -r -- "$1_ARGS=${*[2,-1]}"
      }
      function claude() { _role_probe CLAUDE "$@"; }
      function codex() { _role_probe CODEX "$@"; }
      function cursor() { _role_probe CURSOR "$@"; }
      function agy() { _role_probe AGY "$@"; }
      source "$2"
      # After source: the dispatcher defines these, and its title escapes
      # would otherwise run into the AFTER_ lines.
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      shift 3
      if [[ "$1" == *Codex* && ( "${GOLEM_ROLE:-}" == worker || "$*" == *--worker* || "$1" == *CodexWorker ) ]]; then
        "$@" -E high
      else
        "$@"
      fi
      rc=$?
      print -r -- "AFTER_ROLE_SHELL=${GOLEM_ROLE-unset}"
      print -r -- "AFTER_ROLE_ENV=$(command env | sed -n "s/^GOLEM_ROLE=//p")"
      exit $rc
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$preset" "$@"
}

function split_case_105() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher stub
    for launcher in testrepoCodex testrepoCursor testrepoGemini; do
      case "$launcher" in
        testrepoCodex) stub=CODEX ;;
        testrepoCursor) stub=CURSOR ;;
        testrepoGemini) stub=AGY ;;
      esac
      run_worker_role_launch "" "$launcher" --worker -s
      [ "$status" -eq 0 ]
      grep -F -x -q -- "${stub}_ROLE_SHELL=worker" <<< "$output"
      grep -F -x -q -- "${stub}_ROLE_CHILD=worker" <<< "$output"
    done
}

function split_case_106() {
    [ -f "$SOURCE_DISPATCHER" ]
    run_worker_role_launch "" testrepoCodexWorker -E high -s
    [ "$status" -eq 0 ]
    grep -F -x -q -- "CODEX_ROLE_CHILD=worker" <<< "$output"
}

function split_case_107() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoCodex testrepoCursor testrepoGemini testrepoCodexWorker; do
      run_worker_role_launch "" "$launcher" --worker -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CODEX|CURSOR|AGY)_ROLE_CHILD=worker" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_SHELL=unset" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_ENV=" <<< "$output"
    done
}

function split_case_108() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoCodex testrepoCursor testrepoGemini; do
      run_worker_role_launch lead "$launcher" --worker -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CODEX|CURSOR|AGY)_ROLE_CHILD=worker" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_SHELL=lead" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_ENV=lead" <<< "$output"
    done
}

function split_case_109() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoClaude testrepoCodex testrepoCursor testrepoGemini; do
      run_worker_role_launch worker "$launcher" -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CLAUDE|CODEX|CURSOR|AGY)_ROLE_CHILD=worker" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_ENV=worker" <<< "$output"
    done
}

function split_case_110() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoClaude testrepoCodex testrepoCursor testrepoGemini; do
      run_worker_role_launch "" "$launcher" -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CLAUDE|CODEX|CURSOR|AGY)_ROLE_CHILD=" <<< "$output"
    done
}

function split_case_111() {
    [ -f "$SOURCE_DISPATCHER" ]
    run_worker_role_launch "" testrepoCodex -s -E high -- --worker
    [ "$status" -eq 0 ]
    grep -F -x -q -- "CODEX_ROLE_CHILD=" <<< "$output"
    grep -F -q -- "--worker" <<< "$output"
}

# cmuxlayer passes --worker to EVERY worker, Claude included, and deliberately
# keeps GOLEM_ROLE away from Claude: GOLEM_ROLE=worker drops Claude to medium
# effort. So --worker must leave Claude's effort and environment alone, while a
# caller who sets GOLEM_ROLE=worker explicitly keeps today's medium.
function split_case_112() {
    [ -f "$SOURCE_DISPATCHER" ]
    run_worker_role_launch "" testrepoClaude --worker -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--effort high" <<< "$output"
    refute_contains "--effort medium" "$output" "--worker alone must not lower Claude effort"
    grep -F -x -q -- "CLAUDE_ROLE_CHILD=" <<< "$output"
    grep -F -x -q -- "AFTER_ROLE_SHELL=unset" <<< "$output"

    run_worker_role_launch worker testrepoClaude -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--effort medium" <<< "$output"

    run_worker_role_launch "" testrepoClaude --worker -s -E medium
    [ "$status" -eq 0 ]
    grep -F -q -- "--effort medium" <<< "$output"
}

# ── prelaunch: user-owned commands from the repoGolem config ──────
#
# registry.json's global.prelaunch (generated from the user's own 0600 config)
# runs in the shell that then starts the agent, so exports and ulimit changes
# reach the agent process, and never the caller's interactive shell.
#
# The agent stubs here are real executables on PATH, not shell functions: the
# point is what a separate agent process inherits, and who its parent is.
# $1 is the prelaunch JSON list, or ABSENT for a registry with no such key.
run_prelaunch_launch() {
    local prelaunch="$1"; shift
    local registry="$TMPDIR_/registry-prelaunch.json" bin="$TMPDIR_/prelaunch-bin" name
    if [ "$prelaunch" = ABSENT ]; then
        cp "$REGISTRY_FILE" "$registry"
    else
        jq --argjson prelaunch "$prelaunch" '.global.prelaunch = $prelaunch' "$REGISTRY_FILE" > "$registry"
    fi
    mkdir -p "$bin" "$TMPDIR_/home"
    for name in claude codex cursor agy; do
        cat > "$bin/$name" <<'STUB'
#!/bin/sh
echo "AGENT=${0##*/} PROBE=${PRELAUNCH_PROBE-unset} NOFILE=$(ulimit -n)"
echo "AGENT_PPID=$PPID"
[ -n "$STUB_SIGNAL" ] && kill -s "$STUB_SIGNAL" $$
exit "${STUB_EXIT:-0}"
STUB
        chmod +x "$bin/$name"
    done
    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1" PATH="$3:$PATH" HOME="$4"
      unset PRELAUNCH_PROBE
      ulimit -Sn 256
      source "$2"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      print -r -- "LAUNCHER_PID=$$"
      shift 4
      "$@"
      print -r -- "RC=$?"
      print -r -- "AFTER_PROBE=${PRELAUNCH_PROBE-unset} AFTER_NOFILE=$(ulimit -Sn)"
    ' _ "$registry" "$SOURCE_DISPATCHER" "$bin" "$TMPDIR_/home" "$@"
}

PRELAUNCH_LAUNCHERS=(testrepoClaude testrepoCodex testrepoCursor testrepoGemini)

function split_case_113() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    # shellcheck disable=SC2016 # expanded by the dispatcher, not here
    local prelaunch='["export PRELAUNCH_PROBE=first", "export PRELAUNCH_PROBE=\"$PRELAUNCH_PROBE-second\"", "ulimit -Sn 512"]'
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch "$prelaunch" "$launcher" -s
        [ "$status" -eq 0 ] || { echo "$launcher: $output" >&2; return 1; }
        grep -E -q -- "^AGENT=[a-z]+ PROBE=first-second NOFILE=512$" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        grep -F -x -q -- "RC=0" <<< "$output"
    done
}

function split_case_114() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch '["export PRELAUNCH_PROBE=leaked", "ulimit -Sn 512"]' "$launcher" -s
        [ "$status" -eq 0 ]
        grep -F -q -- "PROBE=leaked NOFILE=512" <<< "$output"
        grep -F -x -q -- "AFTER_PROBE=unset AFTER_NOFILE=256" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
    done
}

function split_case_115() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    # A failed test, a command-not-found, a syntax error, and a command that
    # names itself on stderr: none of their text may reach the output.
    local prelaunch='["test PRELAUNCH_TEXT_MARKER = never", "PRELAUNCH_MISSING_MARKER", "if PRELAUNCH_SYNTAX_MARKER then", "echo PRELAUNCH_STDERR_MARKER >&2; false", "export PRELAUNCH_PROBE=after-failures"]'
    local index
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch "$prelaunch" "$launcher" -s
        [ "$status" -eq 0 ]
        for index in 1 2 3 4; do
            grep -F -q -- "repoGolem: prelaunch command $index failed" <<< "$output" \
              || { echo "$launcher [$index]: $output" >&2; return 1; }
        done
        grep -F -q -- "repoGolem: prelaunch command 2 failed (exit 127)" <<< "$output"
        refute_contains "prelaunch command 5" "$output" "command 5 succeeded"
        refute_contains "_MARKER" "$output" "a failed prelaunch command must never print its text"
        grep -F -q -- "PROBE=after-failures" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        grep -F -x -q -- "RC=0" <<< "$output"
    done
}

function split_case_116() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch '["return 7", "return 0", "export PRELAUNCH_PROBE=after-return"]' "$launcher" -s
        [ "$status" -eq 0 ]
        grep -F -q -- "repoGolem: prelaunch command 1 failed (exit 7)" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        refute_contains "prelaunch command 2" "$output" "return 0 is a success"
        grep -F -q -- "PROBE=after-return" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        grep -F -x -q -- "RC=0" <<< "$output"
    done
}

# exit cannot be contained without running the commands in a further subshell,
# which would drop their effects before the agent starts. It is unsupported;
# what it must do is say so, by index, and pass its status back.
function split_case_117() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch '["true", "exit 3 # PRELAUNCH_EXIT_MARKER"]' "$launcher" -s
        [ "$status" -eq 0 ]
        grep -F -q -- "repoGolem: prelaunch command 2 called exit; the agent was not launched" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        refute_contains "AGENT=" "$output" "the agent must not have started"
        refute_contains "PRELAUNCH_EXIT_MARKER" "$output" "the warning must not echo the command"
        grep -F -x -q -- "RC=3" <<< "$output"
    done
}

function split_case_118() {
    [ -f "$SOURCE_DISPATCHER" ]
    local registry="$TMPDIR_/registry-frames.json" prelaunch launcher stub
    for prelaunch in ABSENT '[]'; do
        if [ "$prelaunch" = ABSENT ]; then
            cp "$REGISTRY_FILE" "$registry"
        else
            jq --argjson p "$prelaunch" '.global.prelaunch = $p' "$REGISTRY_FILE" > "$registry"
        fi
        for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
            case "$launcher" in
                testrepoClaude) stub=claude ;; testrepoCodex) stub=codex ;;
                testrepoCursor) stub=cursor ;; testrepoGemini) stub=agy ;;
            esac
            run zsh -f -c '
              export RALPH_REGISTRY_FILE="$1" HOME="$3"; PRELAUNCH_JQ_LOG="$5"
              function jq() { [[ "$*" == *.global.prelaunch* ]] && print -r -- ran >> "$PRELAUNCH_JQ_LOG"; command jq "$@"; }
              source "$2"
              function _ralph_setup_mcps() { return 0; }
              function _ralph_setup_secrets() { return 0; }
              function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
              function _golem_setup_env() { return 0; }
              function _golem_sync_agy_workspace() { return 0; }
              function _golem_setup_title() { return 0; }
              function _golem_reset_title() { return 0; }
              function claude() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              function codex() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              function cursor() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              function agy() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              "$4" -s
              [[ -s "$PRELAUNCH_JQ_LOG" ]] && print -r -- "PRELAUNCH_JQ_RAN"
              return 0
            ' _ "$registry" "$SOURCE_DISPATCHER" "$TMPDIR_/home" "$launcher" "$TMPDIR_/jq-prelaunch-$launcher-${#prelaunch}.log"
            [ "$status" -eq 0 ] || { echo "$launcher [$prelaunch] status=$status: $output" >&2; return 1; }
            # Exactly the frames #364 produced: the stub, its launcher, dispatch, the wrapper.
            grep -E -x -q -- "FRAMES=${stub},_golem_launch_[a-z]+,_golem_dispatch,${launcher}" <<< "$output" \
              || { echo "$launcher [$prelaunch]: $output" >&2; return 1; }
            if [ "$prelaunch" = ABSENT ]; then
                refute_contains "PRELAUNCH_JQ_RAN" "$output" "no prelaunch key must mean no prelaunch jq"
            else
                # Positive control: the key is present, so the jq read is seen.
                grep -F -x -q -- "PRELAUNCH_JQ_RAN" <<< "$output"
            fi
        done
    done
}

# The dispatcher skips jq when the registry text cannot hold a prelaunch key.
# That shortcut must never miss a real key: JSON may spell it with \u escapes.
# $1 is the registry text; the stub reports the probe variable and its frames,
# and any jq call that reads prelaunch is logged to a file (the dispatcher
# discards that jq's stderr) and reported as PRELAUNCH_JQ_RAN.
run_prelaunch_registry_text() {
    local registry="$TMPDIR_/registry-precheck.json" jq_log="$TMPDIR_/jq-precheck.log"
    rm -f "$jq_log"
    printf '%s\n' "$1" > "$registry"
    jq -e . "$registry" > /dev/null
    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1" HOME="$3"; PRELAUNCH_JQ_LOG="$4"
      unset PRELAUNCH_PROBE
      function jq() { [[ "$*" == *.global.prelaunch* ]] && print -r -- ran >> "$PRELAUNCH_JQ_LOG"; command jq "$@"; }
      source "$2"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() { print -r -- "PROBE=${PRELAUNCH_PROBE-unset} FRAMES=${(j:,:)funcstack}"; }
      testrepoClaude -s
      [[ -s "$PRELAUNCH_JQ_LOG" ]] && print -r -- "PRELAUNCH_JQ_RAN"
      return 0
    ' _ "$registry" "$SOURCE_DISPATCHER" "$TMPDIR_/home" "$jq_log"
}

prelaunch_registry_text() {
    # $1: extra top-level JSON members, spliced in before "projects".
    printf '{%s"projects":{"testrepo":{"path":"%s","mcps":[],"clis":["claude"],"disableChrome":true}}}' "$1" "$PROJECT_DIR"
}

PRELAUNCH_DIRECT_FRAMES="FRAMES=claude,_golem_launch_claude,_golem_dispatch,testrepoClaude"
# One JSON unicode-escape introducer (a backslash, then u), built from octal so
# no literal escape sequence lives in this file.
JSON_U="$(printf '\134')u"

function split_case_119() {
    [ -f "$SOURCE_DISPATCHER" ]
    local members="\"global\":{\"${JSON_U}0070relaunch\":[\"export PRELAUNCH_PROBE=loaded\"]},"
    [[ "$members" != *'"prelaunch"'* ]]
    jq -e '.global.prelaunch == ["export PRELAUNCH_PROBE=loaded"]' <<< "{$members\"x\":1}"
    run_prelaunch_registry_text "$(prelaunch_registry_text "$members")"
    [ "$status" -eq 0 ]
    grep -F -q -- "PROBE=loaded " <<< "$output" || { echo "$output" >&2; return 1; }
}

function split_case_120() {
    [ -f "$SOURCE_DISPATCHER" ]
    run_prelaunch_registry_text "$(prelaunch_registry_text '"global":{"prelaunch":["export PRELAUNCH_PROBE=loaded"]},')"
    [ "$status" -eq 0 ]
    grep -F -q -- "PROBE=loaded " <<< "$output" || { echo "$output" >&2; return 1; }
}

function split_case_121() {
    [ -f "$SOURCE_DISPATCHER" ]
    local members
    for members in '' '"global":{"env":{"NOTE":"run prelaunch later"}},'; do
        run_prelaunch_registry_text "$(prelaunch_registry_text "$members")"
        [ "$status" -eq 0 ]
        grep -F -x -q -- "PROBE=unset $PRELAUNCH_DIRECT_FRAMES" <<< "$output" \
          || { echo "[$members]: $output" >&2; return 1; }
        refute_contains "PRELAUNCH_JQ_RAN" "$output" "no possible prelaunch key must mean no jq"
    done
}

function split_case_122() {
    [ -f "$SOURCE_DISPATCHER" ]
    local members
    # A \u escape anywhere, or "prelaunch" as a whole string value: the text
    # check cannot rule a key out, jq finds none, and the call stays direct.
    for members in "\"global\":{\"env\":{\"NOTE\":\"caf${JSON_U}00e9\"}}," '"global":{"env":{"NOTE":"prelaunch"}},'; do
        run_prelaunch_registry_text "$(prelaunch_registry_text "$members")"
        [ "$status" -eq 0 ]
        grep -F -q -- "PRELAUNCH_JQ_RAN" <<< "$output" || { echo "[$members]: $output" >&2; return 1; }
        grep -F -x -q -- "PROBE=unset $PRELAUNCH_DIRECT_FRAMES" <<< "$output" \
          || { echo "[$members]: $output" >&2; return 1; }
    done
}

