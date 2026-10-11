#!/usr/bin/env bats
load lib/worktree-gc-fixtures

nightly() {
  # The same containment guard fronts the wrapper, using only a fixture lock.
  GC_SOURCE="$REPO_ROOT/scripts/worktree-gc-nightly.sh" \
    GOLEMS_HEAVY_LOCK="$TEST_ROOT/heavy-suite.lock" "$WORKTREE_GC" "$@"
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
  repo="$(make_fixture_repo crash)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  stub="$TEST_ROOT/bin"
  mkdir "$stub"
  printf '#!/usr/bin/env bash\n[[ " $* " == *" worktree list "* ]] && exit 1\nexec "$REAL_GIT" "$@"\n' > "$stub/git"
  chmod +x "$stub/git"
  # Fail from mkdir (GC set -e exit 1), after the wrapper starts its child.
  printf '#!/usr/bin/env bash\n[[ "$1" == -p && "$2" == */docs.local ]] && exit 1\nexec /bin/mkdir "$@"\n' > "$stub/mkdir"
  chmod +x "$stub/mkdir"
  run env REAL_GIT="$(command -v git)" PATH="$stub:$PATH" \
    GC_SOURCE="$REPO_ROOT/scripts/worktree-gc-nightly.sh" GOLEMS_HEAVY_LOCK="$TEST_ROOT/lock" \
    "$WORKTREE_GC" --repo "$repo" --idle-hours 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAILED"* ]] || false
  [ -f "$worktree/fixture.txt" ]
}

@test "nightly R2: completed KEEP-only code succeeds" {
  repo="$(make_fixture_repo keep)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  commit_fixture_file "$worktree" local.txt
  run nightly --repo "$repo" --idle-hours 0
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-unpushed"* ]] || false
}

@test "nightly R2: TERM kills descendants before releasing the lock" {
  repo="$(make_fixture_repo term)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  stub="$TEST_ROOT/bin"
  mkdir "$stub"
  cat > "$stub/git" <<'SH'
#!/usr/bin/env bash
if [[ " $* " == *" fetch "* ]]; then
  sleep 60 &
  echo "$!" > "$GC_CHILD_PID"
  wait
fi
exec "$REAL_GIT" "$@"
SH
  chmod +x "$stub/git"
  run python3 - "$WORKTREE_GC" "$REPO_ROOT/scripts/worktree-gc-nightly.sh" "$repo" "$TEST_ROOT" "$stub" "$(command -v git)" <<'PY'
import os,signal,subprocess,sys,time
runner,source,repo,root,stub,git=sys.argv[1:]
env=dict(os.environ,GC_SOURCE=source,GOLEMS_HEAVY_LOCK=root+'/lock',GC_CHILD_PID=root+'/child',REAL_GIT=git,PATH=stub+':'+os.environ['PATH'])
p=subprocess.Popen([runner,'--repo',repo,'--idle-hours','0'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
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
