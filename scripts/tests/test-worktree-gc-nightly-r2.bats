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
  cp "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh" "$driver/"
  cp "$GC_ENV_SCRUB" "$driver/lib/"
  cp "$stub" "$driver/worktree-gc.sh"
  NIGHTLY_DRIVER="$driver/worktree-gc-nightly.sh"
}

assert_pin_refusal() {
  [ "$status" -ne 0 ]
  [[ "$output" == *"worktree-gc-nightly: REFUSE"*"$1"* ]] || false
  [ "$(printf '%s\n' "$output" | sed -n '/worktree-gc-nightly: REFUSE/p' | wc -l)" -eq 1 ]
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


@test "nightly B1: skip-worktree edited GC refuses before invocation" {
  prepare_stub_pin
  git -C "$NIGHTLY_PIN" update-index --skip-worktree scripts/worktree-gc.sh
  printf '\n# hidden edit\n' >> "$NIGHTLY_PIN/scripts/worktree-gc.sh"
  [ -z "$(git -C "$NIGHTLY_PIN" status --porcelain)" ]
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'pin dirty'
}

@test "nightly B1: assume-unchanged edited GC refuses before invocation" {
  prepare_stub_pin
  git -C "$NIGHTLY_PIN" update-index --assume-unchanged scripts/worktree-gc.sh
  printf '\n# hidden edit\n' >> "$NIGHTLY_PIN/scripts/worktree-gc.sh"
  [ -z "$(git -C "$NIGHTLY_PIN" status --porcelain)" ]
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'pin dirty'
}

@test "nightly B1: replace ref refuses before invocation" {
  prepare_stub_pin
  git -C "$NIGHTLY_PIN" replace HEAD HEAD~1
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'replace refs'
}

@test "nightly R1: pre-floor pin refuses before invocation" {
  prepare_stub_pin
  # Keep runnable files but fork history before the synthetic safety floor.
  old="$(printf 'pre-floor pin\n' | git -C "$NIGHTLY_PIN" -c user.name=Fixture -c user.email=fixture@example.com commit-tree 'HEAD^{tree}' -p HEAD~2)"
  git -C "$NIGHTLY_PIN" checkout -q --detach "$old"
  git -C "$NIGHTLY_PIN" update-ref refs/remotes/origin/master HEAD
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'pin predates GC safety floor'
}

@test "nightly R1: production safety floor is the full ratified commit" {
  run sed -n '/^GC_MIN_SAFE_SHA=/p' "$REPO_ROOT/scripts/worktree-gc-nightly.sh"
  [ "$output" = 'GC_MIN_SAFE_SHA=21051c815433bab7cb77a0633e06b19c10fb2cad' ]
}

@test "nightly N1: logs zero lag and arbitrarily old safe pins without a freshness limit" {
  prepare_stub_pin
  run /bin/bash "$NIGHTLY_DRIVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *'pin is 0 commits behind origin/master'* ]] || false
  for n in {1..12}; do
    git -C "$HOME/Gits/golems" -c user.name=Fixture -c user.email=fixture@example.com commit -qm 'new master' --allow-empty
  done
  git -C "$HOME/Gits/golems" update-ref refs/remotes/origin/master HEAD
  run /bin/bash "$NIGHTLY_DRIVER"
  [ "$status" -eq 0 ]
  [[ "$output" == *'pin is 12 commits behind origin/master'* ]]
}

@test "nightly N2: outside wrapper re-execs pinned wrapper and sources pinned lib" {
  prepare_stub_pin
  export LIB_CALLS="$TEST_ROOT/lib-calls"
  printf '\nprintf "driver\\n" >> "$LIB_CALLS"\n' >> "$driver/lib/worktree-git-env.sh"
  printf '\nprintf "pin\\n" >> "$LIB_CALLS"\n' >> "$NIGHTLY_PIN/scripts/lib/worktree-git-env.sh"
  git -C "$NIGHTLY_PIN" add scripts/lib/worktree-git-env.sh
  git -C "$NIGHTLY_PIN" -c user.name=Fixture -c user.email=fixture@example.com commit -qm 'record pinned library'
  git -C "$NIGHTLY_PIN" update-ref refs/remotes/origin/master HEAD
  run /bin/bash "$NIGHTLY_DRIVER" --idle-hours 12
  [ "$status" -eq 0 ]
  [ "$(cat "$LIB_CALLS")" = $'driver\npin' ]
  [ "$(cat "$GC_CALLS")" = "$NIGHTLY_PIN/scripts/worktree-gc.sh --apply --idle-hours 12" ]
}

@test "nightly N2: re-exec marker refuses an outside wrapper instead of looping" {
  prepare_stub_pin
  run env GOLEMS_WORKTREE_GC_REEXEC=1 /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 're-exec loop'
}

@test "nightly N3: override emits a loud warning with its path even on refusal" {
  prepare_stub_pin
  for path in "$NIGHTLY_PIN" "$TEST_ROOT/missing"; do
    run env GOLEMS_WORKTREE_GC_PIN_ROOT="$path" /bin/bash "$NIGHTLY_DRIVER"
    [[ "$output" == *"WARNING GOLEMS_WORKTREE_GC_PIN_ROOT override in use: $path"* ]] || false
  done
}

@test "nightly N4: local origin/master cannot shadow the remote ancestry ref" {
  prepare_stub_pin
  commit_fixture_file "$NIGHTLY_PIN" side-only
  git -C "$NIGHTLY_PIN" update-ref refs/heads/origin/master HEAD
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'HEAD is not on origin/master'
}

@test "nightly python nit: system python wins over a PATH shim" {
  prepare_stub_pin
  [[ -x /usr/bin/python3 ]] || skip 'system python absent; fallback is required'
  mkdir "$TEST_ROOT/bin"
  printf '#!/bin/sh\nexit 99\n' > "$TEST_ROOT/bin/python3"
  chmod +x "$TEST_ROOT/bin/python3"
  run env PATH="$TEST_ROOT/bin:$PATH" /bin/bash "$NIGHTLY_DRIVER"
  [ "$status" -eq 0 ]
  [ -f "$GC_CALLS" ]
}

@test "nightly docs R1: safety floor maintenance is explicit" {
  run cat "$REPO_ROOT/docs/worktree-gc.md"
  [[ "$output" == *'Raise the floor with every GC safety fix.'* ]]
}

@test "nightly docs N5: refused-night log visibility is explicit" {
  run cat "$REPO_ROOT/docs/worktree-gc.md"
  [[ "$output" == *'Refused nights are visible only in the launchd log (`StandardErrorPath`)'* ]]
}


@test "nightly B1: HEAD diff catches edited GC even if porcelain omits it" {
  prepare_stub_pin
  export REAL_GIT="$(command -v git)"
  mkdir "$TEST_ROOT/bin"
  cat > "$TEST_ROOT/bin/git" <<'SHIM'
#!/bin/bash
for arg in "$@"; do
  [[ "$arg" != status ]] || exit 0
 done
exec "$REAL_GIT" "$@"
SHIM
  chmod +x "$TEST_ROOT/bin/git"
  printf '\n# content changed\n' >> "$NIGHTLY_PIN/scripts/worktree-gc.sh"
  run env PATH="$TEST_ROOT/bin:$PATH" /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'pin dirty'
}

@test "nightly N1: refused dirty pin still logs its measured lag" {
  prepare_stub_pin
  touch "$NIGHTLY_PIN/untracked"
  run /bin/bash "$NIGHTLY_DRIVER"
  assert_pin_refusal 'pin dirty'
  [[ "$output" == *'pin is 0 commits behind origin/master'* ]]
}
