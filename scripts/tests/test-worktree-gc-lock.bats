#!/usr/bin/env bats
load lib/worktree-gc-fixtures

prepare_lock_probes() {
  export REAL_GIT="$(command -v git)" REAL_PYTHON="$(command -v python3)"
  export LOCK_EVENTS="$TEST_ROOT/events" LOCK_PROBE="$TEST_ROOT/probe.py"
  mkdir -p "$TEST_ROOT/bin" "$HOME/Gits"
  cat > "$LOCK_PROBE" <<'PY'
import fcntl, os, subprocess, sys
mode, *detail = sys.argv[1:]
if mode == 'waiter':
    with open(os.environ['GOLEMS_HEAVY_LOCK'], 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_SH)
    sys.exit(0)
if mode == 'fetch':
    # A real blocking suite waiter must finish while this repository scan is paused.
    try:
        subprocess.run([sys.executable, __file__, 'waiter'], timeout=1, check=True)
        state = 'acquired'
    except subprocess.TimeoutExpired:
        state = 'blocked'
else:
    with open(os.environ['GOLEMS_HEAVY_LOCK'], 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
            state = 'free'
        except BlockingIOError:
            state = 'held'
with open(os.environ['LOCK_EVENTS'], 'a') as log:
    log.write(' '.join([mode, state, *detail]) + '\n')
PY
  cat > "$TEST_ROOT/bin/git" <<'SH'
#!/bin/bash
case " $* " in
  *" fetch origin "*) "$REAL_PYTHON" "$LOCK_PROBE" fetch "$2" ;;
  *" worktree remove "*) "$REAL_PYTHON" "$LOCK_PROBE" remove ;;
esac
exec "$REAL_GIT" "$@"
SH
  cat > "$TEST_ROOT/bin/python3" <<'SH'
#!/bin/bash
if [[ "$1" == */worktree-archive.py && "${2:-}" == archive ]]; then
  "$REAL_PYTHON" "$LOCK_PROBE" archive
fi
exec "$REAL_PYTHON" "$@"
SH
  chmod +x "$TEST_ROOT/bin/git" "$TEST_ROOT/bin/python3"
  for name in a b; do
    repo="$(make_fixture_repo "$name")"
    mv "$repo" "$HOME/Gits/$name"
    worktree="$(add_branch_worktree "$HOME/Gits/$name" "candidate-$name")"
    printf 'docs.local/\n' >> "$HOME/Gits/$name/.git/info/exclude"
    mkdir -p "$worktree/docs.local"
    printf 'evidence\n' > "$worktree/docs.local/receipt"
  done
  make_nightly_pin "$GC_SOURCE"
}

@test "nightly yields to suite waiters during scans of two fixture repositories" {
  prepare_lock_probes
  run env PATH="$TEST_ROOT/bin:$PATH" "$WORKTREE_GC_NIGHTLY" --idle-hours 0
  [ "$status" -eq 0 ]
  cat "$LOCK_EVENTS"
  ! grep -q 'fetch blocked' "$LOCK_EVENTS" || return 1
  for name in a b; do
    grep -q "fetch acquired $HOME/Gits/$name" "$LOCK_EVENTS"
    [ ! -e "$HOME/Gits/$name/.worktrees/candidate-$name-worktree" ]
  done
}

@test "nightly archive and remove exclude suites" {
  prepare_lock_probes
  run env PATH="$TEST_ROOT/bin:$PATH" "$WORKTREE_GC_NIGHTLY" --idle-hours 0
  [ "$status" -eq 0 ]
  [ "$(grep -c '^archive held$' "$LOCK_EVENTS")" -eq 2 ]
  [ "$(grep -c '^remove held$' "$LOCK_EVENTS")" -eq 2 ]
  ! grep -q ' free$' "$LOCK_EVENTS" || return 1
  for name in a b; do
    [ "$(cat "$HOME/Gits/$name/docs.local/worktree-archive/candidate-$name-worktree/docs.local/receipt")" = evidence ]
  done
}

@test "nightly scans but keeps busy removals while a suite holds a shared lock" {
  prepare_lock_probes
  run python3 - "$WORKTREE_GC_NIGHTLY" <<'PY'
import fcntl, os, subprocess, sys
with open(os.environ['GOLEMS_HEAVY_LOCK'], 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_SH)
    result = subprocess.run([sys.argv[1], '--idle-hours', '0'], capture_output=True, text=True, timeout=30)
    print(result.stdout, result.stderr)
    assert result.returncode == 0, result.returncode
    assert result.stdout.count('KEEP-busy') == 2, result.stdout
PY
  [ "$status" -eq 0 ]
  for name in a b; do
    [ -e "$HOME/Gits/$name/.worktrees/candidate-$name-worktree/docs.local/receipt" ]
    [ ! -e "$HOME/Gits/$name/docs.local/worktree-archive" ]
  done
  grep -q KEEP-busy "$WORKTREE_GC_REPORT_DIR/latest.json"
}

@test "apply keeps the candidate when its heavy lock cannot be opened" {
  repo="$(make_fixture_repo lock-error)"
  worktree="$(add_branch_worktree "$repo" candidate)"
  run env GOLEMS_HEAVY_LOCK="$TEST_ROOT" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-undetermined*'cannot open heavy-suite lock'* ]] || return 1
  [ -f "$worktree/fixture.txt" ]
  [ ! -e "$repo/docs.local/worktree-archive" ]
}

@test "nightly TERM keeps removal exclusion until the critical process group is killed" {
  prepare_lock_probes
  export ARCHIVE_READY="$TEST_ROOT/archive-ready"
  mkfifo "$ARCHIVE_READY"
  cat > "$TEST_ROOT/bin/python3" <<'SH'
#!/bin/bash
if [[ "$1" == */worktree-archive.py && "${2:-}" == archive ]]; then
  exec "$REAL_PYTHON" -c 'import os, threading
with open(os.environ["ARCHIVE_READY"], "w") as out: out.write(str(os.getpid()) + "\n")
threading.Event().wait(60)'
fi
exec "$REAL_PYTHON" "$@"
SH
  run env PATH="$TEST_ROOT/bin:$PATH" python3 - "$WORKTREE_GC_NIGHTLY" "$HOME/Gits/a" <<'PY'
import fcntl, os, select, signal, subprocess, sys
ready = os.open(os.environ['ARCHIVE_READY'], os.O_RDWR | os.O_NONBLOCK)
p = subprocess.Popen([sys.argv[1], '--repo', sys.argv[2], '--idle-hours', '0'],
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    assert select.select([ready], [], [], 30)[0], 'archive did not start'
    child = int(os.read(ready, 100))
    p.send_signal(signal.SIGTERM)
    with open(os.environ['GOLEMS_HEAVY_LOCK'], 'a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError: pass
        else: raise AssertionError('critical removal lost exclusion')
        out, err = p.communicate(timeout=15)
        print(out, err)
        assert p.returncode == 143, p.returncode
        fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
    probe = subprocess.run(['ps', '-p', str(child), '-o', 'stat='], capture_output=True, text=True)
    assert probe.returncode != 0 or probe.stdout.strip().startswith('Z'), probe.stdout
finally:
    os.close(ready)
    if p.poll() is None:
        p.send_signal(signal.SIGTERM)
        p.communicate(timeout=15)
PY
  [ "$status" -eq 0 ]
  [ -f "$HOME/Gits/a/.worktrees/candidate-a-worktree/fixture.txt" ]
}
