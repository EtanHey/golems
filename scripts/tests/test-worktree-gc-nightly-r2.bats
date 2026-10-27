#!/usr/bin/env bats
load lib/worktree-gc-fixtures

prepare_stub_pin() {
  export GC_CALLS="$TEST_ROOT/gc-calls"
  stub="$TEST_ROOT/stub-gc.sh"
  cat > "$stub" <<'STUB'
#!/bin/bash
printf '%s\n' "$0 $*" >> "$GC_CALLS"
if [[ -n "${GC_CHILD_PID:-}" ]]; then
  sleep 60 &
  echo "$!" > "$GC_CHILD_PID"
  wait
fi
exit "${GC_STUB_EXIT:-0}"
STUB
  make_nightly_pin "$stub"
  # Exercise a copied wrapper, including its unsafe pre-fix sibling fallback.
  driver="$TEST_ROOT/driver"
  mkdir -p "$driver/lib"
  cp "$REPO_ROOT/scripts/worktree-gc-nightly.sh" "$driver/"
  cp "$GC_ENV_SCRUB" "$driver/lib/"
  cp "$stub" "$driver/worktree-gc.sh"
  NIGHTLY_DRIVER="$driver/worktree-gc-nightly.sh"
}

assert_pin_refusal() {
  [ "$status" -ne 0 ]
  [[ "$output" == *"worktree-gc-nightly: REFUSE"*"$1"* ]] || false
  [ "$(printf '%s\n' "$output" | wc -l)" -eq 1 ]
  [[ "$output" =~ pin\ SHA\ ([a-f0-9]{40}|unavailable) ]] || false
  [ ! -e "$GC_CALLS" ]
}

@test "nightly pin: missing default pin refuses without a root-checkout fallback" {
  prepare_stub_pin
  mv "$NIGHTLY_PIN" "$TEST_ROOT/moved-pin"
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'pin missing'
}

@test "nightly pin: dirty tracked and untracked bytes refuse" {
  prepare_stub_pin
  for state in tracked untracked; do
    if [[ "$state" == tracked ]]; then
      printf '\n# dirty\n' >> "$NIGHTLY_PIN/scripts/worktree-gc.sh"
    else
      touch "$NIGHTLY_PIN/untracked"
    fi
    run /bin/bash "$NIGHTLY_DRIVER"
    assert_pin_refusal 'pin dirty'
    git -C "$NIGHTLY_PIN" restore scripts/worktree-gc.sh
  done
}

@test "nightly pin: existing non-git directory refuses with an unavailable SHA" {
  prepare_stub_pin
  mkdir "$TEST_ROOT/not-git"
  run env GOLEMS_WORKTREE_GC_PIN_ROOT="$TEST_ROOT/not-git" /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'pin HEAD unavailable'
}

@test "nightly pin: side-branch HEAD not on origin/master refuses" {
  prepare_stub_pin
  commit_fixture_file "$NIGHTLY_PIN" side-only
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'HEAD is not on origin/master'
}

@test "nightly pin: missing origin/master refuses" {
  prepare_stub_pin
  git -C "$NIGHTLY_PIN" update-ref -d refs/remotes/origin/master
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'origin/master missing'
}

@test "nightly pin: tracked GC symlink escaping the pin refuses" {
  prepare_stub_pin
  rm "$NIGHTLY_PIN/scripts/worktree-gc.sh"
  ln -s "$stub" "$NIGHTLY_PIN/scripts/worktree-gc.sh"
  git -C "$NIGHTLY_PIN" add scripts/worktree-gc.sh
  git -C "$NIGHTLY_PIN" -c user.name=Fixture -c user.email=fixture@example.com commit -qm 'escaping GC'
  git -C "$NIGHTLY_PIN" update-ref refs/remotes/origin/master HEAD
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'GC script outside pin'
}

@test "nightly pin: unrelated git worktree refuses" {
  prepare_stub_pin
  other="$(make_fixture_repo unrelated master)"
  other_pin="$(add_branch_worktree "$other" other-pin origin/master)"
  run env GOLEMS_WORKTREE_GC_PIN_ROOT="$other_pin" /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'not a golems worktree'
}

@test "nightly pin: root checkout and nested directory refuse" {
  prepare_stub_pin
  for path in "$HOME/Gits/golems" "$NIGHTLY_PIN/scripts"; do
    run env GOLEMS_WORKTREE_GC_PIN_ROOT="$path" /bin/bash "$NIGHTLY_DRIVER"
    assert_pin_refusal 'not a golems worktree'
  done
}

@test "nightly pin: clean default pin invokes stub once with --apply and logs SHA" {
  prepare_stub_pin
  sha="$(git -C "$NIGHTLY_PIN" rev-parse HEAD)"
  run /bin/bash "$NIGHTLY_DRIVER" --idle-hours 12
  [ "$status" -eq 0 ]
  [[ "$output" == *"pin SHA $sha"* ]] || false
  [ "$(cat "$GC_CALLS")" = "$NIGHTLY_PIN/scripts/worktree-gc.sh --apply --idle-hours 12" ]
}

@test "nightly pin: override selects a verified golems worktree" {
  prepare_stub_pin
  override="$HOME/Gits/golems/.worktrees/test-pin"
  git -C "$HOME/Gits/golems" worktree add -q --detach "$override" HEAD
  run env GOLEMS_WORKTREE_GC_PIN_ROOT="$override" /bin/bash "$NIGHTLY_DRIVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"pin SHA $(git -C "$override" rev-parse HEAD)"* ]] || false
  [ "$(cat "$GC_CALLS")" = "$override/scripts/worktree-gc.sh --apply" ]
}

@test "nightly pin: clean ancestor of the fetched origin/master is accepted" {
  prepare_stub_pin
  commit_fixture_file "$HOME/Gits/golems" master-only
  git -C "$HOME/Gits/golems" update-ref refs/remotes/origin/master HEAD
  run /bin/bash "$NIGHTLY_DRIVER"
  [ "$status" -eq 0 ]
  [ "$(cat "$GC_CALLS")" = "$NIGHTLY_PIN/scripts/worktree-gc.sh --apply" ]
}

@test "nightly pin: legacy fixture launcher uses a synthetic pin and GC stub" {
  prepare_stub_pin
  run env GC_SOURCE="$stub" "$WORKTREE_GC_NIGHTLY"
  [ "$status" -eq 0 ]
  [ "$(cat "$GC_CALLS")" = "$NIGHTLY_PIN/scripts/worktree-gc.sh --apply" ]
}

nightly() {
  GOLEMS_HEAVY_LOCK="$TEST_ROOT/heavy-suite.lock" "$WORKTREE_GC_NIGHTLY" "$@"
}

@test "nightly R2 containment: nested non-repo cannot evaluate its enclosing fixture" {
  repo="$(make_fixture_repo containment)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  mkdir "$repo/notrepo"
  before="$(git -C "$repo" worktree list --porcelain)"
  run nightly --repo "$repo/notrepo" --idle-hours 0
  [ "$status" -eq 2 ]
  [[ "$output" != *" · "* ]] || false
  [ "$(git -C "$repo" worktree list --porcelain)" = "$before" ]
  [ -f "$worktree/fixture.txt" ]
}

@test "nightly R2: a GC runtime crash remains a failure" {
  prepare_stub_pin
  repo="$(make_fixture_repo crash)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  run env GC_STUB_EXIT=1 /bin/bash "$NIGHTLY_DRIVER" --repo "$repo" --idle-hours 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED"* ]] || false
  [ -f "$worktree/fixture.txt" ]
}

@test "nightly R2: completed KEEP-only code succeeds" {
  prepare_stub_pin
  repo="$(make_fixture_repo keep)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  commit_fixture_file "$worktree" local.txt
  run env GC_STUB_EXIT=3 /bin/bash "$NIGHTLY_DRIVER" --repo "$repo" --idle-hours 0
  [ "$status" -eq 0 ]
  [ -e "$GC_CALLS" ]
  [[ "$output" != *"FAILED"* ]] || false
}

@test "nightly R2: TERM kills descendants before releasing the lock" {
  prepare_stub_pin
  repo="$(make_fixture_repo term)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  run python3 - "$NIGHTLY_DRIVER" "$repo" "$TEST_ROOT" <<'PY'
import os,signal,subprocess,sys,time
runner,repo,root=sys.argv[1:]
env=dict(os.environ,GOLEMS_HEAVY_LOCK=root+'/lock',GC_CHILD_PID=root+'/child')
p=subprocess.Popen(['/bin/bash',runner,'--repo',repo,'--idle-hours','0'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
child=None
try:
    for _ in range(100):
        if os.path.exists(root+'/child'): break
        time.sleep(.05)
    child=int(open(root+'/child').read())
    p.send_signal(signal.SIGTERM)
    out,err=p.communicate(timeout=10)
    print(out,err)
    assert p.returncode==143,p.returncode
    probe=subprocess.run(['ps','-p',str(child),'-o','stat='],capture_output=True,text=True)
    assert probe.returncode!=0 or probe.stdout.strip().startswith('Z'),probe.stdout
finally:
    if p.poll() is None: os.killpg(p.pid,signal.SIGKILL); p.communicate()
    if child:
        try: os.kill(child,signal.SIGKILL)
        except ProcessLookupError: pass
PY
  [ "$status" -eq 0 ]
  [ -d "$worktree" ]
}
