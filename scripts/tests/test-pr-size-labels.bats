#!/usr/bin/env bats
#
# Covers scripts/pr-size-labels.sh. Every gh call goes through the
# PR_SIZE_LABELS_GH seam and lands in a stub, so the suite never hits GitHub.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REPO_ROOT/scripts/pr-size-labels.sh"
  TEST_ROOT="$(mktemp -d)"
  GH_LOG="$TEST_ROOT/gh.log"
  export PR_SIZE_LABELS_OWNER=EtanHey
}

teardown() {
  rm -rf "$TEST_ROOT"
}

# Writes a gh stub that logs every invocation and answers the two read calls
# the script makes: `label list` and `pr view`. Both are called with
# `--jq '.[].name'`, so both stub payloads are bare names, one per line.
make_gh_stub() {
  local labels="$1" pr_labels="${2:-}"
  cat > "$TEST_ROOT/gh" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$GH_LOG"
case "\$1 \$2" in
  "label list") printf '%s' '$labels' ;;
  "pr view")    printf '%s' '$pr_labels' ;;
esac
exit 0
STUB
  chmod +x "$TEST_ROOT/gh"
  export PR_SIZE_LABELS_GH="$TEST_ROOT/gh"
}

@test "classify honours the canon-9 thresholds at every boundary" {
  run "$SCRIPT" classify 0;   [ "$status" -eq 0 ]; [ "$output" = "size:XS" ]
  run "$SCRIPT" classify 20;  [ "$status" -eq 0 ]; [ "$output" = "size:XS" ]
  run "$SCRIPT" classify 21;  [ "$status" -eq 0 ]; [ "$output" = "size:S" ]
  run "$SCRIPT" classify 100; [ "$status" -eq 0 ]; [ "$output" = "size:S" ]
  run "$SCRIPT" classify 101; [ "$status" -eq 0 ]; [ "$output" = "size:M" ]
  run "$SCRIPT" classify 400; [ "$status" -eq 0 ]; [ "$output" = "size:M" ]
  run "$SCRIPT" classify 401; [ "$status" -eq 0 ]; [ "$output" = "size:L" ]
}

@test "classify rejects non-numeric input" {
  run "$SCRIPT" classify abc
  [ "$status" -eq 1 ]
  [[ "$output" == *"not a non-negative integer"* ]]
}

@test "no subcommand and unknown subcommands print usage and exit 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  [[ "$output" == *"usage: pr-size-labels.sh"* ]]

  run "$SCRIPT" frobnicate
  [ "$status" -eq 2 ]
}

@test "compute counts additions plus deletions on hand-written files" {
  make_gh_stub '' ''
  printf 'src/a.ts\t30\t5\nsrc/b.ts\t10\t0\n' > "$TEST_ROOT/files.tsv"
  run "$SCRIPT" compute 7 --repo golems --dry-run --files-tsv "$TEST_ROOT/files.tsv"
  [ "$status" -eq 0 ]
  # repo	pr	old	new	lines  -> 30+5+10+0 = 45
  [ "$output" = $'EtanHey/golems\t7\tnone\tsize:S\t45' ]
}

@test "compute excludes generated, lock, vendored and fixture files" {
  make_gh_stub '' ''
  cat > "$TEST_ROOT/files.tsv" <<'TSV'
bun.lock	5000	1
package-lock.json	4000	0
pnpm-lock.yaml	900	0
go.sum	120	3
packages/x/dist/bundle.js	9000	0
dist/bundle.js	9000	0
node_modules/dep/index.js	800	0
web/.next/static/chunk.js	700	0
vendor/lib.go	600	0
src/__snapshots__/a.test.ts.snap	400	0
scripts/tests/fixtures/sample.json	300	0
packages/y/testdata/big.json	200	0
api/schema.pb.go	150	0
proto/thing_pb2.py	150	0
src/types.generated.ts	150	0
public/app.min.js	100	0
public/app.min.css	100	0
public/app.js.map	100	0
src/real.ts	7	4
TSV
  run "$SCRIPT" compute 7 --repo golems --dry-run --files-tsv "$TEST_ROOT/files.tsv"
  [ "$status" -eq 0 ]
  # only src/real.ts counts: 7 + 4 = 11
  [ "$output" = $'EtanHey/golems\t7\tnone\tsize:XS\t11' ]
}

@test "compute reports the existing labels it found and stays dry on --dry-run" {
  make_gh_stub '' $'size/XS\nbug'
  printf 'src/a.ts\t500\t0\n' > "$TEST_ROOT/files.tsv"
  run "$SCRIPT" compute 12 --repo EtanHey/golems --dry-run --files-tsv "$TEST_ROOT/files.tsv"
  [ "$status" -eq 0 ]
  [ "$output" = $'EtanHey/golems\t12\tsize/XS\tsize:L\t500' ]

  run grep -c "pr edit" "$GH_LOG"
  [ "$output" = "0" ]
}

@test "compute applies exactly one label and removes every other size:* and size/*" {
  make_gh_stub '' $'size/XS\nsize:M\nsize:L\nenhancement'
  printf 'src/a.ts\t40\t2\n' > "$TEST_ROOT/files.tsv"
  run "$SCRIPT" compute 12 --repo golems --files-tsv "$TEST_ROOT/files.tsv"
  [ "$status" -eq 0 ]

  edit="$(grep '^pr edit' "$GH_LOG")"
  [[ "$edit" == *"--add-label size:S"* ]]
  [[ "$edit" == *"--remove-label size/XS"* ]]
  [[ "$edit" == *"--remove-label size:M"* ]]
  [[ "$edit" == *"--remove-label size:L"* ]]
  [[ "$edit" != *"--remove-label size:S"* ]]
  [[ "$edit" != *"enhancement"* ]]
  # exactly one add-label
  [ "$(grep -o -- '--add-label' <<<"$edit" | wc -l | tr -d ' ')" = "1" ]
}

@test "compute requires --repo" {
  make_gh_stub '' ''
  run "$SCRIPT" compute 12
  [ "$status" -eq 1 ]
  [[ "$output" == *"--repo <owner/name> is required"* ]]
}

@test "ensure creates all four labels with the fixed colors and descriptions" {
  make_gh_stub 'bug' ''
  run "$SCRIPT" ensure golems
  [ "$status" -eq 0 ]

  grep -qF 'label create size:XS --repo EtanHey/golems --color 0E8A16' "$GH_LOG"
  grep -qF 'label create size:S --repo EtanHey/golems --color FBCA04' "$GH_LOG"
  grep -qF 'label create size:M --repo EtanHey/golems --color D93F0B' "$GH_LOG"
  grep -qF 'label create size:L --repo EtanHey/golems --color B60205' "$GH_LOG"

  # every create is idempotent
  [ "$(grep -c -- '--force' "$GH_LOG")" -eq 4 ]
  # L carries the canon-9 one-liner requirement in its description
  grep -qF 'canon 9 needs a one-line why' "$GH_LOG"
  # nothing was renamed: there were no legacy labels
  run grep -c 'label edit' "$GH_LOG"
  [ "$output" = "0" ]
}

@test "ensure renames legacy size/* instead of deleting it" {
  make_gh_stub $'size/XS\nsize/S\nbug' ''
  run "$SCRIPT" ensure golems
  [ "$status" -eq 0 ]

  grep -qF 'label edit size/XS --repo EtanHey/golems --name size:XS' "$GH_LOG"
  grep -qF 'label edit size/S --repo EtanHey/golems --name size:S' "$GH_LOG"
  [[ "$output" == *"RENAMED EtanHey/golems: size/XS -> size:XS"* ]]

  # a rename, never a delete -- deleting would strip the label off old PRs
  run grep -c 'label delete' "$GH_LOG"
  [ "$output" = "0" ]
}

@test "ensure refuses to guess when both schemes exist for the same size" {
  make_gh_stub $'size/XS\nsize:XS' ''
  run "$SCRIPT" ensure golems
  [ "$status" -eq 0 ]
  [[ "$output" == *"both size/XS and size:XS exist"* ]]

  run grep -c 'label edit' "$GH_LOG"
  [ "$output" = "0" ]
}

@test "ensure is idempotent on a repo already at the target state" {
  make_gh_stub $'size:XS\nsize:S\nsize:M\nsize:L' ''
  run "$SCRIPT" ensure golems
  [ "$status" -eq 0 ]
  [ "$(grep -c 'label create' "$GH_LOG")" -eq 4 ]
  run grep -c 'label edit' "$GH_LOG"
  [ "$output" = "0" ]
}

@test "check warns without failing when a PR has no size label" {
  make_gh_stub '' $'bug\nenhancement'
  run "$SCRIPT" check 42 --repo golems
  [ "$status" -eq 0 ]
  [[ "$output" == *"::warning::EtanHey/golems#42 has no size:* label"* ]]
}

@test "check warns on the retired slash scheme" {
  make_gh_stub '' $'size/M'
  run "$SCRIPT" check 42 --repo golems
  [ "$status" -eq 0 ]
  [[ "$output" == *"::warning::"* ]]
  [[ "$output" == *"retired size/* scheme"* ]]
}

@test "check is quiet and green when the PR is labeled" {
  make_gh_stub '' $'size:M\nbug'
  run "$SCRIPT" check 42 --repo golems
  [ "$status" -eq 0 ]
  [[ "$output" != *"::warning::"* ]]
  [[ "$output" == *"OK EtanHey/golems#42 has a size label: size:M"* ]]
}
