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
import errno, os, subprocess
check_output = subprocess.check_output
def fixture_output(command, *args, **kwargs):
    if command in (["ps", "-axo", "pid=,lstart="], ["/bin/ps", "-axo", "pid=,lstart="]):
        if os.environ.get('PS_TIMEOUT'):
            assert command[0] == '/bin/ps' and kwargs.get('timeout') == 30
            raise subprocess.TimeoutExpired(command, kwargs['timeout'])
        command = [os.environ['PS_STUB'], *command[1:]]
    return check_output(command, *args, **kwargs)
subprocess.check_output = fixture_output
def refuse_signal(*args):
    with open(os.environ['SIGNAL_TRACE'], 'a') as out:
        out.write('signal attempted\n')
    raise PermissionError(errno.EPERM, 'fixture foreign process')
os.kill = refuse_signal
PY
  chmod +x "$TEST_ROOT/bin/ps" "$TEST_ROOT/bin/lsof"
  export PATH="$TEST_ROOT/bin:$PATH" PS_STUB="$TEST_ROOT/bin/ps"
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
  printf '4242 Wed Jan  1 00:00:00 2020    \n' > "$PS_ROWS"
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
  printf '4242 Wed Jan  1 00:00:00 2020    \n' > "$PS_ROWS"
  registry_row 4242 "$worktree" 1735689600000
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-live*cmux* ]] || return 1
  [ -d "$worktree" ]
  [ ! -e "$SIGNAL_TRACE" ]
}

@test "R2d reused PID started after registry timestamp permits removal" {
  registry_fixture
  printf '4242 Thu Jan  1 00:00:00 2026    \n' > "$PS_ROWS"
  registry_row 4242 "$worktree" 1735689600000
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
  [ ! -e "$SIGNAL_TRACE" ]
}

@test "R2d absent PID is dead and permits removal" {
  registry_fixture
  printf '4243 Wed Jan  1 00:00:00 2020    \n' > "$PS_ROWS"
  registry_row 4242 "$worktree"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
}

@test "R2d absent or invalid row timestamp conservatively keeps live paths" {
  registry_fixture
  printf '4242 Thu Jan  1 00:00:00 2026    \n' > "$PS_ROWS"
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

@test "R2d failed or timed out process snapshot keeps all candidates undetermined" {
  registry_fixture
  other="$(add_branch_worktree "$repo" sibling)"
  registry_row 4242 "$worktree"
  for failure in PS_FAIL PS_TIMEOUT; do
    run env "$failure=1" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ "$status" -eq 0 ]
    [[ "$output" == *KEEP-undetermined*registry* ]] || return 1
    [ -d "$worktree" ]
    [ -d "$other" ]
  done
}

@test "R2d malformed rows warn and count without disabling valid sibling rows" {
  registry_fixture
  printf '4242 Wed Jan  1 00:00:00 2020    \n' > "$PS_ROWS"
  registry_row 4242 "$TEST_ROOT/elsewhere"
  printf '%s\n' '{bad' '{"pid":true,"cwd":"/"}' '{"pid":4242,"cwd":"relative"}' >> "$WORKTREE_GC_CMUX_REGISTRY"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
  [[ "$output" == *"registry line 2"* ]] || return 1
  [[ "$output" == *"encountered 3 malformed registry rows"* ]] || return 1
}

@test "R2d captured macOS padded ps line detects a reused PID" {
  registry_fixture
  # Captured from /bin/ps -axo pid=,lstart= on macOS, including four trailing spaces.
  printf '    1 Mon Oct 12 13:15:20 2026    \n' > "$PS_ROWS"
  registry_row 1 "$worktree" 1735689600000
  run python3 "$REPO_ROOT/scripts/lib/worktree-registry-cwds.py" "$WORKTREE_GC_CMUX_REGISTRY"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "R2d invalid PID retains every valid absolute path" {
  registry_fixture
  printf '4242 Wed Jan  1 00:00:00 2020    \n' > "$PS_ROWS"
  for pid in null true '"unknown"' 0 -1 2147483648; do
    printf '{"pid":%s,"cwd":"%s","worktree_path":"relative","launch_cwd":"/protected"}\n' \
      "$pid" "$worktree" > "$WORKTREE_GC_CMUX_REGISTRY"
    run python3 "$REPO_ROOT/scripts/lib/worktree-registry-cwds.py" "$WORKTREE_GC_CMUX_REGISTRY"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$worktree"* && "$output" == *'/protected'* ]] || return 1
    [[ "$output" != *$'\nrelative'* ]] || return 1
    [[ "$output" == *'invalid pid'* && "$output" == *'1 malformed registry rows'* ]] || return 1
  done
}

@test "R2d registry is fully read before the process snapshot" {
  run python3 - "$REPO_ROOT/scripts/lib/worktree-registry-cwds.py" <<'PY'
import io, json, runpy, sys
from unittest.mock import patch
census = runpy.run_path(sys.argv[1])['census']
read = []
class Registry(io.StringIO):
    def __iter__(self):
        yield from iter(self.readline, '')
        read.append(True)
def snapshot():
    assert read, 'process snapshot preceded registry read'
    return {4242: None}
with patch('builtins.open', return_value=Registry(json.dumps(dict(pid=4242, cwd='/protected')))):
    with patch.dict(census.__globals__, process_starts=snapshot):
        census('fixture')
PY
  [ "$status" -eq 0 ]
  [ "$output" = /protected ]
}

@test "R2d clock skew within 120 seconds retains the live path" {
  registry_fixture
  printf '4242 Thu Jan  1 00:00:00 2026    \n' > "$PS_ROWS"
  for seconds in 0 119 120; do
    timestamp="$(python3 - "$seconds" <<'PY'
import datetime, sys
print(int((datetime.datetime(2026, 1, 1).timestamp() - int(sys.argv[1])) * 1000))
PY
)"
    : > "$WORKTREE_GC_CMUX_REGISTRY"
    registry_row 4242 "$worktree" "$timestamp"
    run python3 "$REPO_ROOT/scripts/lib/worktree-registry-cwds.py" "$WORKTREE_GC_CMUX_REGISTRY"
    [ "$status" -eq 0 ]
    if [[ "$seconds" -lt 120 ]]; then
      [ "$output" = "$worktree" ]
    else
      [ -z "$output" ]
    fi
  done
}

@test "R2d real bin ps retains the running test shell" {
  registry_fixture
  registry_row "$$" "$worktree" "$(python3 -c 'import time; print(int(time.time()*1000))')"
  run env -u PYTHONPATH python3 "$REPO_ROOT/scripts/lib/worktree-registry-cwds.py" "$WORKTREE_GC_CMUX_REGISTRY"
  [ "$status" -eq 0 ]
  [ "$output" = "$worktree" ]
  [ ! -e "$PS_TRACE" ]
}

@test "R2d undetermined non-git paths appear in the owner report" {
  path="$TEST_ROOT/broken"
  mkdir -p "$path" "$WORKTREE_GC_REPORT_DIR"
  journal="$TEST_ROOT/journal.jsonl"
  : > "$journal"
  run python3 "$REPO_ROOT/scripts/lib/worktree-gc-state.py" add "$journal" fixture "$path" candidate \
    KEEP-undetermined 'cannot resolve HEAD'
  [ "$status" -eq 0 ]
  run python3 "$REPO_ROOT/scripts/lib/worktree-gc-state.py" finish "$journal" "$WORKTREE_GC_REPORT_DIR" 0 1
  [ "$status" -eq 0 ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$WORKTREE_GC_REPORT_DIR/latest.md" "$path" <<'PY'
import json, sys
row, = json.load(open(sys.argv[1]))['owners']['fixture']
assert row['path'] == sys.argv[3] and row['branch'] == 'unknown'
assert row['birth_epoch'] is None and row['reason'] == 'KEEP-undetermined'
assert row['detail'] == 'cannot resolve HEAD'
assert row['path'] in open(sys.argv[2]).read()
PY
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
