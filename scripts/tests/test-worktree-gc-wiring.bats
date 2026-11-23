#!/usr/bin/env bats
load lib/worktree-gc-fixtures
prepare() {
  stub="$TEST_ROOT/stub"
  printf '#!/bin/bash\n[[ "$*" != *--prune-plan* ]] || exit 0
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
@test "wiring: floor includes archiver fix" {
  run sed -n '/^GC_MIN_SAFE_SHA=/p' "$REPO_ROOT/scripts/worktree-gc-nightly.sh"
  [ "$output" = 'GC_MIN_SAFE_SHA=c2fb389974ebc18df088a28e08f011220edd2b8f' ]
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
