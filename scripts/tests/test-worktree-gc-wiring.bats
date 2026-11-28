#!/usr/bin/env bats
load lib/worktree-gc-fixtures
prepare() {
  stub="$TEST_ROOT/stub"
  printf '#!/bin/bash\n[[ "$*" != *--prune-plan* ]] || exit 3
[[ "$*" == *--apply* ]] && printf "fixture · tree · branch · dirty=0 · ahead=0 · REMOVED · removed\\n"\nexit "${GC_STUB_EXIT:-0}"\n' > "$stub"
  make_nightly_pin "$stub"
  export GOLEMS_WORKTREE_GC_NOTIFY="$TEST_ROOT/inbox"
}
release_pin() {
  mkdir -p "$HOME/.golems/releases"
  release="$HOME/.golems/releases/test"
  mkdir "$release"
  cp -R "$NIGHTLY_PIN/scripts" "$release/"
  python3 - "$release" "$(git -C "$NIGHTLY_PIN" rev-parse HEAD)" <<'PY'
import pathlib,json,hashlib,stat,sys
p=pathlib.Path(sys.argv[1]); files=[]
for f in p.rglob('*'):
 if f.is_file(): files.append(dict(path=str(f.relative_to(p)),sha256=hashlib.sha256(f.read_bytes()).hexdigest(),mode=format(stat.S_IMODE(f.stat().st_mode),'04o')))
m=dict(version='test',commit=sys.argv[2],files=files)
b=json.dumps(m).encode(); (p/'MANIFEST.json').write_bytes(b)
(p.parent.parent/'release.json').write_text(json.dumps(dict(version='test',commit=sys.argv[2],manifest_sha256=hashlib.sha256(b).hexdigest())))
PY
  ln -s "$release" "$HOME/.golems/current"
  export GOLEMS_WORKTREE_GC_PIN_ROOT="$release"
}
@test "wiring: release pin runs and sends one removal receipt" {
  prepare; release_pin
  run bash "$release/scripts/worktree-gc-nightly.sh"
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$GOLEMS_WORKTREE_GC_NOTIFY")" -eq 1 ]
  [[ "$(cat "$GOLEMS_WORKTREE_GC_NOTIFY")" == *'removed=1 receipt='* ]]
}
@test "wiring: corrupt release refuses and alarms once" {
  prepare; release_pin
  printf '\ncorrupt\n' >> "$release/scripts/worktree-gc.sh"
  run bash "$release/scripts/worktree-gc-nightly.sh"
  [ "$status" -eq 2 ]
  [ "$(wc -l < "$GOLEMS_WORKTREE_GC_NOTIFY")" -eq 1 ]
  [[ "$(cat "$GOLEMS_WORKTREE_GC_NOTIFY")" == 'ALARM '* ]]
}
@test "wiring: raw failure alarms once" {
  prepare
  run env GC_STUB_EXIT=1 bash "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh"
  [ "$status" -eq 1 ]
  [[ "$(cat "$GOLEMS_WORKTREE_GC_NOTIFY")" == 'ALARM '* ]]
}
@test "wiring: floor includes fresh-worktree safety fix" {
  run sed -n '/^GC_MIN_SAFE_SHA=/p' "$REPO_ROOT/scripts/worktree-gc-nightly.sh"
  [ "$output" = 'GC_MIN_SAFE_SHA=e0ea3fd5a5cafb51fd70e5ccf23a296c80c60149' ]
}
@test "wiring: clean zero-removal night stays silent" {
  prepare
  printf '#!/bin/bash\nexit 0\n' > "$NIGHTLY_PIN/scripts/worktree-gc.sh"
  git -C "$NIGHTLY_PIN" add scripts/worktree-gc.sh
  git -C "$NIGHTLY_PIN" -c user.name=Fixture -c user.email=fixture@example.com commit -qm silent
  git -C "$NIGHTLY_PIN" update-ref refs/remotes/origin/master HEAD
  run bash "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh"
  [ "$status" -eq 0 ]
  [ ! -e "$GOLEMS_WORKTREE_GC_NOTIFY" ]
}
@test "wiring: timeout alarms exactly once" {
  prepare
  printf '#!/bin/bash\nsleep 60\n' > "$NIGHTLY_PIN/scripts/worktree-gc.sh"
  git -C "$NIGHTLY_PIN" add scripts/worktree-gc.sh
  git -C "$NIGHTLY_PIN" -c user.name=Fixture -c user.email=fixture@example.com commit -qm timeout
  git -C "$NIGHTLY_PIN" update-ref refs/remotes/origin/master HEAD
  run env WORKTREE_GC_NIGHTLY_TIMEOUT=1 bash "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh"
  [ "$status" -eq 124 ]
  [ "$(wc -l < "$GOLEMS_WORKTREE_GC_NOTIFY")" -eq 1 ]
  [[ "$(cat "$GOLEMS_WORKTREE_GC_NOTIFY")" == 'ALARM worktree-gc exit=124 '* ]]
}
@test "wiring: suite is registered with CI" {
  run python3 - "$REPO_ROOT/scripts/ci/bats-suites.json" <<'PY'
import json,sys
assert 'test-worktree-gc-wiring.bats' in json.load(open(sys.argv[1]))['run']
PY
  [ "$status" -eq 0 ]
}
@test "wiring: log destination accepts main-checkout override" {
  run python3 - "$REPO_ROOT/scripts/worktree-gc.sh" <<'PY'
import pathlib,sys
assert 'LOG_DIR="${WORKTREE_GC_LOG_DIR:-$SCRIPT_DIR/../docs.local}"' in pathlib.Path(sys.argv[1]).read_text()
PY
  [ "$status" -eq 0 ]
}
@test "wiring: bytecode refusal and release-only plist setup are documented" {
  run cat "$REPO_ROOT/docs/worktree-gc.md"
  [[ "$output" == *'Stray `__pycache__/*.pyc` files are refused'* ]] || false
  [[ "$output" == *'GOLEMS_WORKTREE_GC_PIN_ROOT'* ]]
}

# Retained independent Opus red-team repros (round 1).
stubpin() { # $1 = stub body
  stub="$TEST_ROOT/stub"; printf '#!/bin/bash\n%s\n' "$1" > "$stub"; chmod +x "$stub"
  make_nightly_pin "$stub"; export GOLEMS_WORKTREE_GC_NOTIFY="$TEST_ROOT/inbox" CALLS="$TEST_ROOT/calls"
}
@test "R1 any KEEP-unpushed (plan exit 3) must not skip --apply" {
  stubpin 'echo "$*" >> "$CALLS"
[[ "$*" == *--prune-plan* ]] && exit 3
[[ "$*" == *--apply* ]] && echo "r · /w · b · dirty=0 · ahead=0 · REMOVED · removed"
exit 3'
  run bash "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh"
  echo "status=$status calls=$(cat "$CALLS")"; echo "inbox=$(cat "$GOLEMS_WORKTREE_GC_NOTIFY" 2>&1)"
  [ "$status" -eq 0 ]
  grep -q -- --apply "$CALLS"
}
@test "R2 SIGTERM to the wrapper must kill the GC group and exit 143" {
  stubpin 'echo "$*" >> "$CALLS"; [[ "$*" == *--prune-plan* ]] && exit 0
sleep 60 & echo $! > "$TEST_ROOT/child"; wait'
  run python3 - "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh" "$TEST_ROOT" <<'PY'
import os,signal,subprocess,sys,time
w,root=sys.argv[1:]
p=subprocess.Popen(['/bin/bash',w],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
for _ in range(200):
    if os.path.exists(root+'/child'): break
    time.sleep(.05)
child=int(open(root+'/child').read()); p.send_signal(signal.SIGTERM); p.communicate(timeout=20); time.sleep(1)
alive=subprocess.run(['ps','-p',str(child),'-o','stat='],capture_output=True,text=True).stdout.strip()
print('wrapper rc',p.returncode,'gc child stat',repr(alive))
os.killpg(p.pid,signal.SIGKILL) if False else None
try: os.kill(child,signal.SIGKILL)
except ProcessLookupError: pass
sys.exit(0 if p.returncode==143 and (not alive or alive.startswith('Z')) else 1)
PY
  echo "$output"; [ "$status" -eq 0 ]
}
@test "R3a non-UTF-8 byte in a failing run's output must still ALARM" {
  stubpin '[[ "$*" == *--prune-plan* ]] && exit 0
printf "boom \xff\n"; exit 1'
  run bash "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh"
  echo "status=$status inbox=$(cat "$GOLEMS_WORKTREE_GC_NOTIFY" 2>&1)"; echo "$output" | tail -3
  [ "$status" -eq 1 ]; grep -q '^ALARM ' "$GOLEMS_WORKTREE_GC_NOTIFY"
}
@test "R3b unwritable receipt file must still ALARM" {
  stubpin 'exit 0'
  export GOLEMS_WORKTREE_GC_RECEIPT_DIR="$TEST_ROOT/receipts"; mkdir -p "$GOLEMS_WORKTREE_GC_RECEIPT_DIR"; chmod 500 "$GOLEMS_WORKTREE_GC_RECEIPT_DIR"
  run bash "$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh"
  chmod 700 "$GOLEMS_WORKTREE_GC_RECEIPT_DIR"
  echo "status=$status inbox=$(cat "$GOLEMS_WORKTREE_GC_NOTIFY" 2>&1)"; echo "$output" | tail -3
  [ "$status" -ne 0 ]; grep -q '^ALARM ' "$GOLEMS_WORKTREE_GC_NOTIFY"
}
@test "R4 release whose scripts differ from its commit must refuse (self-consistent manifest)" {
  stubpin '[[ "$*" == *--prune-plan* ]] && exit 0; echo TAMPERED-GC-RAN; exit 0'
  mkdir -p "$HOME/.golems/releases"; release="$HOME/.golems/releases/test"; mkdir "$release"
  cp -R "$NIGHTLY_PIN/scripts" "$release/"
  printf '#!/bin/bash\necho TAMPERED-BYTES-NOT-IN-COMMIT "$*"\n' > "$release/scripts/worktree-gc.sh"
  python3 - "$release" "$(git -C "$NIGHTLY_PIN" rev-parse HEAD)" <<'PY'
import pathlib,json,hashlib,stat,sys
p=pathlib.Path(sys.argv[1]); files=[]
for f in p.rglob('*'):
  if f.is_file(): files.append(dict(path=str(f.relative_to(p)),sha256=hashlib.sha256(f.read_bytes()).hexdigest(),mode=format(stat.S_IMODE(f.stat().st_mode),'04o')))
b=json.dumps(dict(version='test',commit=sys.argv[2],files=files)).encode(); (p/'MANIFEST.json').write_bytes(b)
(p.parent.parent/'release.json').write_text(json.dumps(dict(version='test',commit=sys.argv[2],manifest_sha256=hashlib.sha256(b).hexdigest())))
PY
  ln -s releases/test "$HOME/.golems/current"
  run env GOLEMS_WORKTREE_GC_PIN_ROOT="$HOME/.golems/current" bash "$release/scripts/worktree-gc-nightly.sh"
  echo "status=$status"; echo "$output" | grep -E 'verified|TAMPERED|REFUSE'
  echo "$output" >&3; [[ "$output" != *TAMPERED-BYTES-NOT-IN-COMMIT* ]]
}
@test "wiring: real GC writes logs to the supplied main-checkout directory" {
  repo="$(make_fixture_repo log-override)"
  add_branch_worktree "$repo" log-candidate >/dev/null
  logs="$TEST_ROOT/main-logs"
  run env WORKTREE_GC_LOG_DIR="$logs" "$WORKTREE_GC" --prune-plan --repo "$repo"
  [ "$status" -eq 0 ]
  [ -d "$logs" ]
  [ "$(find "$logs" -name '*.log' | wc -l)" -ge 1 ]
}
