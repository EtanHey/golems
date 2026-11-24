#!/usr/bin/env bats
load lib/worktree-gc-fixtures

sibling_fixture() {
  repo="$(make_fixture_repo sibling)"
  mkdir -p "$HOME/Gits"
  mv "$repo" "$HOME/Gits/sibling"
  repo="$HOME/Gits/sibling"
  root="$repo-worktrees"
  worktree="$root/lane"
  git -C "$repo" worktree add -q -b lane "$worktree" origin/main
  mkdir -p "$TEST_ROOT/bin"
  printf '#!/bin/sh\nprintf "[]\\n"\n' > "$TEST_ROOT/bin/gh"
  printf '#!/bin/sh\nprintf "p1\\nn/fixture-idle\\n"\n' > "$TEST_ROOT/bin/lsof"
  printf '#!/bin/sh\nprintf "1\\n"\n' > "$TEST_ROOT/bin/ps"
  chmod +x "$TEST_ROOT/bin/"*
  export PATH="$TEST_ROOT/bin:$PATH"
}

@test "sibling: default sweep is dry; apply archives notes and removes registered idle tree" {
  sibling_fixture
  printf 'docs.local/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$worktree/docs.local"
  printf proof > "$worktree/docs.local/note"
  run "$WORKTREE_GC"
  [ "$status" -eq 0 ]
  [[ "$output" == *" · REMOVE · "* ]] || false
  [ -f "$worktree/fixture.txt" ]
  run "$WORKTREE_GC" --apply --idle-hours 0
  [ "$status" -eq 0 ]
  [[ "$output" == *" · REMOVED · "* ]] || false
  [ ! -e "$worktree" ]
  receipt="$repo/docs.local/worktree-archive/lane/RECEIPT.tsv"
  [ -f "$receipt" ]
  grep -q "$(shasum -a 256 "$repo/docs.local/worktree-archive/lane/docs.local/note" | cut -d ' ' -f 1)" "$receipt"
  [[ "$(git -C "$repo" worktree list --porcelain)" != *"$worktree"* ]] || false
}

@test "sibling: unregistered directory and nested clone are kept and reported" {
  sibling_fixture
  mkdir -p "$root/unregistered"
  git init -q "$root/clone"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"$root/unregistered · - · dirty=not-checked · ahead=not-checked · KEEP-out-of-scope"* ]] || false
  [[ "$output" == *"$root/clone · - · dirty=not-checked · ahead=not-checked · KEEP-out-of-scope"* ]] || false
  [ -d "$root/unregistered" ]
  [ -d "$root/clone/.git" ]
}

@test "sibling: another repository registration is never admitted" {
  sibling_fixture
  other="$(make_fixture_repo other)"
  git -C "$other" worktree add -q --detach "$root/foreign" origin/main
  before="$(git -C "$other" worktree list --porcelain)"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"$root/foreign · - · dirty=not-checked · ahead=not-checked · KEEP-out-of-scope"* ]] || false
  [ "$before" = "$(git -C "$other" worktree list --porcelain)" ]
}

@test "sibling: symlinked root or entry is refused in sweep and path modes" {
  sibling_fixture
  mv "$root" "$root-real"
  ln -s "$root-real" "$root"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-out-of-scope"*"symlink"* ]] || false
  [ -f "$worktree/fixture.txt" ]
  run "$WORKTREE_GC" --apply --path "$worktree"
  [ "$status" -eq 2 ]
  unlink "$root"
  mv "$root-real" "$root"
  mv "$worktree" "$root/real-entry"
  ln -s "$root/real-entry" "$worktree"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-out-of-scope"*"symlink"* ]] || false
  [ -f "$worktree/fixture.txt" ]
  run "$WORKTREE_GC" --path "$worktree"
  [ "$status" -eq 2 ]
}

@test "sibling: dirty and unpushed trees retain ordinary guards" {
  sibling_fixture
  printf WIP > "$worktree/WIP"
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-dirty"* ]] || false
  commit_fixture_file "$worktree" WIP
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$worktree"
  [ "$status" -eq 3 ]
  [[ "$output" == *"KEEP-unpushed"* ]] || false
  [ -f "$worktree/WIP" ]
}

@test "sibling: path mode removes only selected tree and refuses main checkout" {
  sibling_fixture
  git -C "$repo" worktree add -q -b sentinel "$root/sentinel" origin/main
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == *" · REMOVED · "* ]] || false
  [ ! -e "$worktree" ]
  [ -f "$root/sentinel/fixture.txt" ]
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$repo"
  [ "$status" -eq 2 ]
  [ -d "$repo/.git" ]
  [ -f "$repo/fixture.txt" ]
}

@test "sibling: idle open-PR T3 binding hidden flags and nested scope stay guarded" {
  sibling_fixture
  run "$WORKTREE_GC" --apply --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-active"* ]] || false
  git -C "$repo" config url."$TEST_ROOT/sibling-origin.git".insteadOf https://github.com/fixture/sibling.git
  git -C "$repo" remote set-url origin https://github.com/fixture/sibling.git
  cat > "$TEST_ROOT/bin/gh" <<'GH'
#!/bin/sh
printf '%s\n' '[{"headRefName":"lane","number":1}]'
GH
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-open-pr"* ]] || false
  printf '#!/bin/sh\nprintf "[]\\n"\n' > "$TEST_ROOT/bin/gh"
  git -C "$worktree" update-index --assume-unchanged fixture.txt
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == *"assume-unchanged"* ]] || false
  git -C "$worktree" update-index --no-assume-unchanged fixture.txt
  sqlite3 "$WORKTREE_GC_T3_DB" 'DROP TABLE orchestration_v2_projection_threads;'
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-undetermined"*"t3-state-unproven"* ]] || false
  [ -f "$worktree/fixture.txt" ]
}

@test "sibling: nested registrations and sibling namespaces outside HOME Gits are out of scope" {
  sibling_fixture
  git -C "$repo" worktree add -q --detach "$root/group/nested" origin/main
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$root/group/nested"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-out-of-scope"* ]] || false
  outside="$(make_fixture_repo outside)"
  git -C "$outside" worktree add -q --detach "$outside-worktrees/lane" origin/main
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$outside"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-out-of-scope"* ]] || false
  [ -f "$root/group/nested/fixture.txt" ]
  [ -f "$outside-worktrees/lane/fixture.txt" ]
}

@test "sibling: fresh unregistered and foreign entries reach latest owner report" {
  sibling_fixture
  mkdir -p "$root/unregistered"
  printf 'owner attention\n' > "$root/unregistered/notes.txt"
  other="$(make_fixture_repo other)"
  git -C "$other" worktree add -q --detach "$root/foreign" origin/main
  git init -q "$root/clone"
  run "$WORKTREE_GC"
  [ "$status" -eq 0 ]
  python3 - "$WORKTREE_GC_REPORT_DIR" "$root" <<'PYTEST'
import json, pathlib, sys
reports, root = map(pathlib.Path, sys.argv[1:])
report = json.loads((reports / 'latest.json').read_text())
rows = report['owners']['sibling']
for name in ('unregistered', 'foreign', 'clone'):
    row, = [row for row in rows if row['path'] == str(root / name)]
    assert row['repo'] == 'sibling', row
    assert row['reason'] == 'KEEP-out-of-scope', row
    assert 'not a registered same-repo sibling worktree' in row['detail'], row
    assert isinstance(row['size_bytes'], int) and row['size_bytes'] > 0, row
    assert (root / name).is_dir()
assert json.loads((reports / 'last-run.json').read_text()) == report
assert 'unregistered' in (reports / 'latest.md').read_text()
PYTEST
  printf '#!/bin/sh\nexit 1\n' > "$TEST_ROOT/bin/du"
  chmod +x "$TEST_ROOT/bin/du"
  run "$WORKTREE_GC"
  [ "$status" -eq 0 ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$root/unregistered" <<'PYTEST'
import json, sys
report = json.load(open(sys.argv[1]))
row, = [row for row in report['owners']['sibling'] if row['path'] == sys.argv[2]]
assert row['size_bytes'] is None and row['reason'] == 'KEEP-out-of-scope', row
PYTEST
}
