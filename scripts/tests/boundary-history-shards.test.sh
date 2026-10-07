#!/usr/bin/env bash
# Synthetic merge graph: shard union must equal the original genesis..HEAD set.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd -P)
helper=${BOUNDARY_SHARD_HELPER:-$root/scripts/ci/boundary-history-shards.sh}
mkdir -p "$root/docs.local/nightly-security"
scratch=$(mktemp -d "$root/docs.local/nightly-security/shards-test.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
git init -q "$scratch/repo"
cd "$scratch/repo"
git config user.name 'Shard Fixture'
git config user.email 'shard@example.com'
git commit -q --allow-empty -m genesis
base=$(git rev-parse HEAD)
for n in 1 2 3 4 5; do git commit -q --allow-empty -m "main $n"; done
main=$(git rev-parse HEAD)
git checkout -q -b side "$base"
for n in 1 2 3; do git commit -q --allow-empty -m "side $n"; done
git merge -q --no-ff "$main" -m merge
expected=$(git rev-list --reverse "$base..HEAD")
for count in 1 2 4 16; do
  : > "$scratch/union"
  for ((index=0; index<count; index++)); do
    bash "$helper" "$base" "$index" "$count" >> "$scratch/union"
  done
  printf '%s\n' "$expected" | sort > "$scratch/expected"
  sort "$scratch/union" > "$scratch/actual"
  diff -u "$scratch/expected" "$scratch/actual"
  [[ $(sort "$scratch/union" | uniq -d | wc -l | tr -d ' ') == 0 ]]
done
[[ $(bash "$helper" "$base" 0 1) == "$expected" ]]
for args in '0 0' '2 2' '-1 4' 'x 4' '0 04' '0 17'; do
  if bash "$helper" "$base" $args > /dev/null 2>&1; then
    echo "FAIL accepted invalid shard $args"; exit 1
  fi
done
if bash "$helper" missing 0 1 >/dev/null 2>&1; then exit 1; fi
git checkout -q --orphan unrelated
git commit -q --allow-empty -m unrelated
if bash "$helper" "$base" 0 1 >/dev/null 2>&1; then exit 1; fi
git checkout -q --detach "$main"
git clone -q --depth=1 "file://$scratch/repo" "$scratch/shallow"
if (cd "$scratch/shallow" && bash "$helper" HEAD 0 1 >/dev/null 2>&1); then exit 1; fi
ruby -ryaml -ropen3 -rjson -e '
  wf = YAML.safe_load(File.read(ARGV[0]))
  guard = wf.fetch("jobs").fetch("publish-boundary")
  abort "required context must be unique and non-matrix" unless guard.fetch("name") == "Publish Boundary Guard" && wf.fetch("jobs").values.count { |job| job["name"] == "Publish Boundary Guard" } == 1 && !guard.key?("strategy")
  abort "aggregate must always await shards" unless guard.fetch("needs") == ["publish-boundary-shards"] && guard.fetch("if") == "always()"
  gate = guard.fetch("steps").first
  abort "aggregate result not wired" unless gate.fetch("env").fetch("SHARDS_RESULT") == "${{ needs.publish-boundary-shards.result }}"
  abort "aggregate evidence not wired" unless gate.fetch("env").fetch("SHARD_OUTPUTS") == "${{ toJSON(needs.publish-boundary-shards.outputs) }}"
  count_expr = gate.fetch("env").fetch("EXPECTED_COUNT")
  abort "aggregate event count missing" unless count_expr.include?("schedule") && count_expr.include?("workflow_dispatch") && count_expr.include?("16 || 1")
  [1, 16].each do |count|
    complete = (0...count).to_h { |i| ["shard_#{i}", "success"] }
    cases = [[complete, true], [{}, false], [complete.merge("shard_16" => "success"), false]]
    (0...count).each do |i|
      cases << [complete.reject { |k, _| k == "shard_#{i}" }, false]
      ["failure", "cancelled", "skipped", ""].each { |value| cases << [complete.merge("shard_#{i}" => value), false] }
    end
    (%w[success failure cancelled skipped] + [""]).each do |result|
      cases.each do |evidence, valid|
        output, status = Open3.capture2e({"SHARDS_RESULT" => result, "SHARD_OUTPUTS" => JSON.generate(evidence), "EXPECTED_COUNT" => count.to_s}, "bash", "-e", "-c", gate.fetch("run"))
        abort "aggregate accepted #{result}/#{count}/#{evidence}: #{output}" unless status.success? == (result == "success" && valid)
      end
    end
  end
  j = wf.fetch("jobs").fetch("publish-boundary-shards")
  expected_outputs = (0...16).to_h { |i| ["shard_#{i}", "${{ matrix.shard == #{i} && steps.scan.outcome || #{39.chr}#{39.chr} }}"] }
  abort "distinct scan outputs missing" unless j.fetch("outputs") == expected_outputs
  abort "missing fail-fast false" unless j.fetch("strategy").fetch("fail-fast") == false
  matrix = j.fetch("strategy").fetch("matrix").fetch("shard").to_s
  abort "missing 16-shard full scan" unless matrix.include?((0...16).to_a.join(","))
  abort "missing single shard PR/push" unless matrix.include?("[0]")
  step = j.fetch("steps").find { |s| s["name"] == "Enforce publication boundary" }
  abort "scan outcome not wired" unless step.fetch("id") == "scan"
  abort "shard not wired" unless step.fetch("env").fetch("PUBLISH_BOUNDARY_HISTORY_SHARD_INDEX").include?("matrix.shard")
  abort "count not wired" unless step.fetch("env").fetch("PUBLISH_BOUNDARY_HISTORY_SHARD_COUNT").include?("16")
  abort "summary missing shards" unless wf.fetch("jobs").fetch("summary").fetch("needs").include?("publish-boundary")
' "${BOUNDARY_WORKFLOW:-$root/.github/workflows/security.yml}"
echo 'PASS: merge graph coverage, disjoint shards, empty shards, invalid inputs, workflow wiring'
