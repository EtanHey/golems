#!/usr/bin/env bats
load lib/worktree-gc-fixtures

registry_fixture() {
  repo="$(make_fixture_repo registry)"
  mkdir -p "$HOME/Gits"
  mv "$repo" "$HOME/Gits/"; repo="$HOME/Gits/registry"
  worktree="$(add_branch_worktree "$repo" candidate)"
  mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/python"
  export PS_ROWS="$TEST_ROOT/ps-rows" PS_TRACE="$TEST_ROOT/ps-trace"
  export SIGNAL_TRACE="$TEST_ROOT/signals" PYTHONPATH="$TEST_ROOT/python"
  : > "$PS_ROWS"
  cat > "$TEST_ROOT/bin/ps" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == '-axo pid=,lstart=' ]]; then
  echo snapshot >> "$PS_TRACE"
  [[ "${PS_FAIL:-0}" == 0 ]] || exit 1
  cat "$PS_ROWS"
else
  echo 4242
fi
STUB
  cat > "$TEST_ROOT/bin/lsof" <<'STUB'
#!/usr/bin/env bash
printf 'p4242\nn%s\n' "$GC_FIXTURE_ROOT"
STUB
  # Simulate EPERM without signalling any real process, including signal 0.
  cat > "$TEST_ROOT/python/sitecustomize.py" <<'PY'
import errno, os
def refuse_signal(*args):
    with open(os.environ['SIGNAL_TRACE'], 'a') as out:
        out.write('signal attempted\n')
    raise PermissionError(errno.EPERM, 'fixture foreign process')
os.kill = refuse_signal
PY
  chmod +x "$TEST_ROOT/bin/ps" "$TEST_ROOT/bin/lsof"
  export PATH="$TEST_ROOT/bin:$PATH"
}

registry_row() {
  python3 - "$WORKTREE_GC_CMUX_REGISTRY" "$1" "$2" "${3:-}" <<'PY'
import json, sys
row = dict(pid=int(sys.argv[2]), cwd=sys.argv[3])
if sys.argv[4]:
    row['ts'] = int(sys.argv[4])
with open(sys.argv[1], 'a') as out:
    out.write(json.dumps(row) + '\n')
PY
}

@test "R2d foreign unsignalable registry row cannot block an unrelated removal" {
  registry_fixture
  printf '4242 Wed Jan  1 00:00:00 2020\n' > "$PS_ROWS"
  registry_row 4242 "$TEST_ROOT/elsewhere" 1735689600000
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
  [ ! -e "$SIGNAL_TRACE" ]
  [ "$(wc -l < "$PS_TRACE" | tr -d ' ')" -eq 1 ]
}

@test "R2d live PID started before registry timestamp keeps its worktree" {
  registry_fixture
  printf '4242 Wed Jan  1 00:00:00 2020\n' > "$PS_ROWS"
  registry_row 4242 "$worktree" 1735689600000
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-live*cmux* ]] || return 1
  [ -d "$worktree" ]
  [ ! -e "$SIGNAL_TRACE" ]
}

@test "R2d reused PID started after registry timestamp permits removal" {
  registry_fixture
  printf '4242 Thu Jan  1 00:00:00 2026\n' > "$PS_ROWS"
  registry_row 4242 "$worktree" 1735689600000
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
  [ ! -e "$SIGNAL_TRACE" ]
}

@test "R2d absent PID is dead and permits removal" {
  registry_fixture
  printf '4243 Wed Jan  1 00:00:00 2020\n' > "$PS_ROWS"
  registry_row 4242 "$worktree"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
}

@test "R2d absent or invalid row timestamp conservatively keeps live paths" {
  registry_fixture
  printf '4242 Thu Jan  1 00:00:00 2026\n' > "$PS_ROWS"
  for timestamp in absent invalid; do
    : > "$WORKTREE_GC_CMUX_REGISTRY"
    registry_row 4242 "$worktree"
    if [[ "$timestamp" == invalid ]]; then
      python3 - "$WORKTREE_GC_CMUX_REGISTRY" <<'PY'
import json, sys
path = sys.argv[1]
row = json.load(open(path)); row['ts'] = 'unknown'
with open(path, 'w') as out:
    out.write(json.dumps(row) + '\n')
PY
    fi
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ "$status" -eq 0 ]
    [[ "$output" == *KEEP-live*cmux* ]] || return 1
    [ -d "$worktree" ]
  done
}

@test "R2d unknown start time protects only that registry row" {
  registry_fixture
  other="$(add_branch_worktree "$repo" sibling)"
  printf '4242 unknown\n' > "$PS_ROWS"
  registry_row 4242 "$worktree" 1735689600000
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-live*cmux* ]] || return 1
  [ -d "$worktree" ]
  [[ "$output" == *"$other"*REMOVED* ]] || return 1
  [ ! -e "$other" ]
}

@test "R2d failed process snapshot protects registered paths but permits unrelated removal" {
  registry_fixture
  other="$(add_branch_worktree "$repo" sibling)"
  registry_row 4242 "$worktree"
  run env PS_FAIL=1 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-live*cmux* ]] || return 1
  [ -d "$worktree" ]
  [[ "$output" == *"$other"*REMOVED* ]] || return 1
  [ ! -e "$other" ]
}

@test "R2d malformed rows warn and count without disabling valid sibling rows" {
  registry_fixture
  printf '4242 Wed Jan  1 00:00:00 2020\n' > "$PS_ROWS"
  registry_row 4242 "$TEST_ROOT/elsewhere"
  printf '%s\n' '{bad' '{"pid":true,"cwd":"/"}' '{"pid":4242,"cwd":"relative"}' >> "$WORKTREE_GC_CMUX_REGISTRY"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
  [[ "$output" == *"registry line 2"* ]] || return 1
  [[ "$output" == *"skipped 3 malformed registry rows"* ]] || return 1
}

@test "R2d missing or entirely unparseable registry keeps candidates undetermined" {
  registry_fixture
  for state in missing invalid; do
    if [[ "$state" == missing ]]; then
      rm "$WORKTREE_GC_CMUX_REGISTRY"
    else
      printf '{bad\n' > "$WORKTREE_GC_CMUX_REGISTRY"
    fi
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ "$status" -eq 0 ]
    [[ "$output" == *KEEP-undetermined*registry* ]] || return 1
    [ -d "$worktree" ]
  done
}

@test "R2d undetermined rows and reasons appear in owner reports even for young worktrees" {
  registry_fixture
  rm "$WORKTREE_GC_CMUX_REGISTRY"
  run "$WORKTREE_GC" --apply --idle-hours 0
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-undetermined*registry* ]] || return 1
  [ -d "$worktree" ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$WORKTREE_GC_REPORT_DIR/latest.md" "$worktree" <<'PY'
import json, sys
row, = json.load(open(sys.argv[1]))['owners']['registry']
assert row['path'] == sys.argv[3]
assert row['reason'] == 'KEEP-undetermined' and 'registry missing' in row['detail']
markdown = open(sys.argv[2]).read()
assert row['path'] in markdown and row['reason'] in markdown and row['detail'] in markdown
PY
}
