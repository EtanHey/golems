#!/usr/bin/env bash
# Tests scripts/ci/secret-scan.sh, the wrapper behind the required "Secret
# Scanning" check: how it reads the scanner's exit status, logs and output,
# that it never prints a secret value, that its canary goes red for a scanner
# that finds nothing or is mis-invoked, and the secret-scan job's shape.
#
# The stub cases run anywhere. The live cases need the pinned TruffleHog
# binary: set TRUFFLEHOG to it (CI does), or they are skipped when no
# trufflehog is on PATH.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/../.." && pwd -P)
wrapper=${SECRET_SCAN_WRAPPER:-"$repo_root/scripts/ci/secret-scan.sh"}
workflow=${SECRET_SCAN_WORKFLOW:-"$repo_root/.github/workflows/security.yml"}
tmp_parent=${TMPDIR:-/tmp}
tmp_parent=${tmp_parent%/}
suite_root=$(mktemp -d "$tmp_parent/secret-scan-test.XXXXXX")
pass_count=0
fail_count=0

cleanup() {
  case "$suite_root" in
    "$tmp_parent"/secret-scan-test.*) rm -rf -- "$suite_root" ;;
    *) printf 'REFUSING unsafe cleanup path: %s\n' "$suite_root" >&2 ;;
  esac
}
trap cleanup EXIT

pass() { pass_count=$((pass_count + 1)); printf 'PASS %s\n' "$1"; }
fail() { fail_count=$((fail_count + 1)); printf 'FAIL %s\n' "$1"; }

# A fake scanner. Every call prints STUB_STDOUT to stdout and STUB_STDERR to
# stderr, then exits STUB_RC, whatever its arguments. With STUB_ARGS_LOG set,
# it also records its arguments there, and the contents of each
# --exclude-paths file in STUB_ARGS_LOG.excludes.
stub="$suite_root/stub-trufflehog"
cat > "$stub" <<'STUB'
#!/usr/bin/env bash
if [[ -n ${STUB_ARGS_LOG:-} ]]; then
  printf '%s\n' "$*" >> "$STUB_ARGS_LOG"
  prev=
  for a in "$@"; do
    [[ $prev == --exclude-paths ]] && cat "$a" >> "$STUB_ARGS_LOG.excludes"
    prev=$a
  done
fi
[[ -n ${STUB_STDOUT:-} ]] && printf '%s\n' "$STUB_STDOUT"
[[ -n ${STUB_STDERR:-} ]] && printf '%s\n' "$STUB_STDERR" >&2
exit "${STUB_RC:-0}"
STUB
chmod +x "$stub"

# genesis -> head, with the checkout on head.
fixture="$suite_root/repo"
mkdir -p "$fixture"
git -C "$fixture" init -q
git -C "$fixture" config user.name "Scan Fixture"
git -C "$fixture" config user.email "scan-fixture@example.com"
commit() { git -C "$fixture" commit -q --allow-empty -m "$1"; git -C "$fixture" rev-parse HEAD; }
genesis=$(commit genesis)
commit head >/dev/null

# The stub's fake finding carries this value in Raw and RawV2. The wrapper must
# never print it.
fake_secret="stub-raw-value-that-must-never-print"
finding=$(printf '{"DetectorName":"AWS","Verified":false,"VerificationError":"dial tcp: refused","Raw":"%s","RawV2":"%s","Redacted":"%s","SourceMetadata":{"Data":{"Git":{"file":"config/app.yml","line":7,"commit":"0123456789abcdef"}}}}' \
  "$fake_secret" "$fake_secret" "$fake_secret")
info_log='{"level":"info-0","msg":"finished scanning"}'
error_log='{"level":"error","msg":"encountered errors during scan","error":"unknown revision"}'
# Scanner logs can quote scanned content, so on a tool error the wrapper must
# print none of them: each of these carries the value in a different place.
leaky_stderr="error: could not parse $fake_secret"
leaky_error_msg=$(printf '{"level":"error","msg":"chunk %s","error":"x"}' "$fake_secret")
leaky_error_field=$(printf '{"level":"error","msg":"error reading chunk","error":"near %s"}' "$fake_secret")
leaky_info_msg=$(printf '{"level":"info-0","msg":"scanning %s"}' "$fake_secret")

# expect_scan <label> <want-exit> <stdout> <stderr> <rc> [<must-print-regex>]
expect_scan() {
  local label=$1 want=$2 out=$3 err=$4 rc=$5 must=${6:-} got=0 log
  log=$(cd "$fixture" && STUB_STDOUT=$out STUB_STDERR=$err STUB_RC=$rc TRUFFLEHOG=$stub \
    bash "$wrapper" scan schedule "$genesis" 2>&1) || got=$?
  if [[ $got != "$want" ]]; then
    fail "$label: want exit $want, got $got"$'\n'"$log"
  elif [[ $log == *"$fake_secret"* ]]; then
    fail "$label: printed the secret value"
  elif [[ -n $must && ! $log =~ $must ]]; then
    fail "$label: output does not match /$must/"$'\n'"$log"
  else
    pass "$label"
  fi
}

expect_scan "clean scan passes" 0 "" "$info_log" 0
expect_scan "a finding fails, annotated with detector, file and line but no value" 1 \
  "$finding" "$info_log" 183 '::error file=config/app\.yml,line=7::.*AWS.*unknown'
expect_scan "a scanner usage error fails (the old pip v2 install)" 2 \
  "" "error: unrecognized arguments: filesystem" 2 'exited 2'
expect_scan "an unexpected exit status fails" 2 "" "$info_log" 1 'exited 1'
expect_scan "an error-level log line fails even when the scanner exits 0" 2 \
  "" "$error_log" 0 'logged 1 error'
expect_scan "a tool error does not print plain stderr" 2 "" "$leaky_stderr" 2 'exited 2'
expect_scan "a tool error does not print a log line's msg" 2 "" "$leaky_info_msg" 1 'exited 1'
expect_scan "an error-level line's msg is not printed" 2 "" "$leaky_error_msg" 0 'logged 1 error'
expect_scan "an error-level line's error field is not printed" 2 "" "$leaky_error_field" 0 'logged 1 error'
expect_scan "findings without the --fail exit status fail as a tool error" 2 "$finding" "$info_log" 0
expect_scan "the --fail exit status without findings fails as a tool error" 2 "" "$info_log" 183
expect_scan "output that is not JSON fails as a tool error" 2 "not json" "$info_log" 0

# Tracked content is scanned wherever it lives: history gets no path excludes,
# and the working-tree scan excludes only .git/, which git cannot track.
args_log="$suite_root/args.log"
(cd "$fixture" && STUB_ARGS_LOG=$args_log STUB_STDERR=$info_log TRUFFLEHOG=$stub \
  bash "$wrapper" scan schedule "$genesis" >/dev/null 2>&1) || true
history_args=$(grep '^git ' "$args_log" || true)
tree_args=$(grep '^filesystem ' "$args_log" || true)
excludes=$(cat "$args_log.excludes" 2>/dev/null || true)
if [[ -z $history_args || -z $tree_args ]]; then
  fail "exclude contract: the scan did not run both git and filesystem"$'\n'"$(cat "$args_log" 2>/dev/null)"
elif [[ $history_args == *--exclude-paths* ]]; then
  fail "the history scan excludes paths: $history_args"
elif [[ $excludes != '(^|/)\.git/' ]]; then
  fail "the working-tree scan excludes more than .git/:"$'\n'"$excludes"
else
  pass "history scans every path; the working tree skips only .git/"
fi

# A scan needs a base: a pull_request with no origin/master cannot pick one.
got=0
(cd "$fixture" && TRUFFLEHOG=$stub bash "$wrapper" scan pull_request "$genesis" >/dev/null 2>&1) || got=$?
if [[ $got == 2 ]]; then pass "no usable history base fails as a tool error"
else fail "no usable history base: want exit 2, got $got"; fi

# The canary must go red for a scanner that never finds anything, and for one
# that always does (its clean control must pass).
expect_canary_red() {
  local label=$1 out=$2 rc=$3 got=0
  (cd "$fixture" && STUB_STDOUT=$out STUB_STDERR=$info_log STUB_RC=$rc TRUFFLEHOG=$stub \
    bash "$wrapper" canary >/dev/null 2>&1) || got=$?
  if [[ $got != 0 ]]; then pass "$label"; else fail "$label: canary passed"; fi
}
expect_canary_red "canary is red when the scanner finds nothing" "" 0
expect_canary_red "canary is red when the scanner flags a clean tree" "$finding" 183

# Audit the actual canary files through the wrapper's scanner boundary. This
# independently computes the same Shannon entropy used by TruffleHog 3.97.9
# and requires a 0.25-bit margin above its 3.0 ID and 4.25 secret thresholds.
# It also rejects repeated IDs or secrets, since each planted path needs a
# distinct pair for the four-path coverage assertion to be meaningful.
entropy_log="$suite_root/canary-entropy.log"
entropy_scanner="$suite_root/entropy-trufflehog"
cat > "$entropy_scanner" <<'ENTROPY_STUB'
#!/usr/bin/env bash
set -euo pipefail

kind=${1:?missing scanner kind}
source_path=${2:?missing scanner source}
case $kind in
  git) repo=${source_path#file://}; metadata=Git ;;
  filesystem) repo=$source_path; metadata=Filesystem ;;
  *) exit 2 ;;
esac

shannon_entropy() {
  LC_ALL=C awk -v value="$1" 'BEGIN {
    length_value = length(value)
    for (i = 1; i <= length_value; i++) counts[substr(value, i, 1)]++
    entropy = 0
    for (character in counts) {
      probability = counts[character] / length_value
      entropy -= probability * log(probability) / log(2)
    }
    printf "%.12f", entropy
  }'
}

entropy_at_least() {
  awk -v actual="$1" -v minimum="$2" 'BEGIN { exit !(actual >= minimum) }'
}

already_seen() {
  local needle=$1 value
  shift
  for value in "$@"; do
    [[ $value == "$needle" ]] && return 0
  done
  return 1
}

# The empty sentinel keeps Bash 3.2's nounset mode from rejecting an expansion
# of an empty array before the first credential is checked.
seen_ids=('')
seen_secrets=('')
found=0
for file in credentials dist/credentials build/credentials node_modules/canary-pkg/credentials; do
  case $kind in
    git) content=$(git -C "$repo" show "HEAD:$file" 2>/dev/null || true) ;;
    filesystem)
      [[ -f "$repo/$file" ]] || continue
      content=$(<"$repo/$file")
      ;;
  esac
  id=$(sed -n 's/^aws_access_key_id = //p' <<<"$content")
  secret=$(sed -n 's/^aws_secret_access_key = //p' <<<"$content")
  [[ -n $id && -n $secret ]] || continue

  id_entropy=$(shannon_entropy "$id")
  secret_entropy=$(shannon_entropy "$secret")
  if ! entropy_at_least "$id_entropy" 3.25; then
    printf 'ID entropy below 3.25 in %s: %s\n' "$file" "$id_entropy" >&2
    exit 2
  fi
  if ! entropy_at_least "$secret_entropy" 4.50; then
    printf 'secret entropy below 4.50 in %s: %s\n' "$file" "$secret_entropy" >&2
    exit 2
  fi
  if already_seen "$id" "${seen_ids[@]}" || already_seen "$secret" "${seen_secrets[@]}"; then
    printf 'duplicate canary material in %s\n' "$file" >&2
    exit 2
  fi
  seen_ids+=("$id")
  seen_secrets+=("$secret")
  printf 'id\t%s\t%s\nsecret\t%s\t%s\n' \
    "$file" "$id_entropy" "$file" "$secret_entropy" >> "$ENTROPY_LOG"

  if [[ $metadata == Git ]]; then
    jq -nc --arg file "$file" '{
      DetectorName: "AWS", Verified: false, VerificationError: "offline canary test",
      SourceMetadata: {Data: {Git: {file: $file, line: 2, commit: "canary"}}}
    }'
  else
    jq -nc --arg file "$file" '{
      DetectorName: "AWS", Verified: false, VerificationError: "offline canary test",
      SourceMetadata: {Data: {Filesystem: {file: $file, line: 2}}}
    }'
  fi
  found=$((found + 1))
done

(( found == 0 )) && exit 0
exit 183
ENTROPY_STUB
chmod +x "$entropy_scanner"
got=0
entropy_run_log=$(ENTROPY_LOG=$entropy_log TRUFFLEHOG=$entropy_scanner \
  bash "$wrapper" canary 2>&1) || got=$?
id_audits=$(grep -c $'^id\t' "$entropy_log" 2>/dev/null || true)
secret_audits=$(grep -c $'^secret\t' "$entropy_log" 2>/dev/null || true)
if [[ $got != 0 ]]; then
  fail "generated canaries satisfy entropy margins and are distinct: exit $got"$'\n'"$entropy_run_log"
elif [[ $id_audits != 8 || $secret_audits != 8 ]]; then
  fail "generated canary entropy audit covered every history/tree value: IDs=$id_audits secrets=$secret_audits"
else
  pass "generated canaries exceed entropy thresholds with margin and are distinct per path"
fi

# Live cases against the pinned scanner.
real=${TRUFFLEHOG:-$(command -v trufflehog || true)}
if [[ -z $real ]]; then
  printf 'SKIP live canary: no TruffleHog binary (set TRUFFLEHOG)\n'
else
  got=0
  canary_log=$(TRUFFLEHOG=$real bash "$wrapper" canary 2>&1) || got=$?
  if [[ $got == 0 && $canary_log == *"canary: PASS"* ]]; then
    pass "canary is green with the pinned scanner"
  else
    fail "canary with the pinned scanner: exit $got"$'\n'"$canary_log"
  fi

  # Mis-invocations: a wrong subcommand, and a removed flag.
  miswired="$suite_root/miswired-trufflehog"
  printf '#!/usr/bin/env bash\nsub=$1; shift\nexec %q "${sub}x" "$@"\n' "$real" > "$miswired"
  chmod +x "$miswired"
  got=0
  TRUFFLEHOG=$miswired bash "$wrapper" canary >/dev/null 2>&1 || got=$?
  if [[ $got != 0 ]]; then pass "canary is red when the scanner subcommand is wrong"
  else fail "canary passed with a wrong subcommand"; fi

  unflagged="$suite_root/unflagged-trufflehog"
  printf '#!/usr/bin/env bash\nargs=()\nfor a in "$@"; do [[ $a == --fail ]] || args+=("$a"); done\nexec %q "${args[@]}"\n' \
    "$real" > "$unflagged"
  chmod +x "$unflagged"
  got=0
  TRUFFLEHOG=$unflagged bash "$wrapper" canary >/dev/null 2>&1 || got=$?
  if [[ $got != 0 ]]; then pass "canary is red when the scanner runs without --fail"
  else fail "canary passed without --fail"; fi

  # Re-adding a path exclude, in history or on disk, must turn the canary red:
  # it plants a key under each of these segments.
  for segment in dist build node_modules; do
    excluding="$suite_root/excluding-$segment-trufflehog"
    printf '(^|/)%s/\n' "$segment" > "$suite_root/exclude-$segment"
    cat > "$excluding" <<WRAP
#!/usr/bin/env bash
args=() prev= added=
for a in "\$@"; do
  if [[ \$prev == --exclude-paths ]]; then cat $(printf %q "$suite_root/exclude-$segment") >> "\$a"; added=1; fi
  args+=("\$a"); prev=\$a
done
[[ -n \$added ]] || args+=(--exclude-paths $(printf %q "$suite_root/exclude-$segment"))
exec $(printf %q "$real") "\${args[@]}"
WRAP
    chmod +x "$excluding"
    got=0
    TRUFFLEHOG=$excluding bash "$wrapper" canary >/dev/null 2>&1 || got=$?
    if [[ $got != 0 ]]; then pass "canary is red when scans exclude $segment/"
    else fail "canary passed while scans excluded $segment/"; fi
  done
fi

# Job shape: the pinned binary is checksum-verified, the canary runs before
# the scan, and nothing in the job can swallow a failure.
if shape=$(ruby -ryaml -e '
  wf = YAML.safe_load(File.read(ARGV[0]), aliases: false)
  job = wf["jobs"]["secret-scan"] or abort "no secret-scan job"
  abort "job name is not Secret Scanning (the required check)" unless job["name"] == "Secret Scanning"
  abort "job has continue-on-error" if job.key?("continue-on-error")
  steps = job["steps"]
  soft = steps.select { |s| s.key?("continue-on-error") }.map { |s| s["name"] }
  abort "steps with continue-on-error: #{soft.join(", ")}" unless soft.empty?
  runs = steps.map { |s| s["run"].to_s }
  abort "a step still installs TruffleHog from pip" if runs.any? { |r| r.include?("pip install") }
  env = job["env"] || {}
  # The runner context does not exist at job level: GitHub rejects the whole
  # workflow file, so no job in it runs.
  bad = env.select { |_, v| v.to_s.include?("runner.") }.keys
  abort "job-level env uses the runner context: #{bad.join(", ")}" unless bad.empty?
  abort "TRUFFLEHOG_VERSION is not pinned to an exact release" unless env["TRUFFLEHOG_VERSION"].to_s =~ /\A\d+\.\d+\.\d+\z/
  abort "TRUFFLEHOG_SHA256 is not a sha256" unless env["TRUFFLEHOG_SHA256"].to_s =~ /\A\h{64}\z/
  install = runs.index { |r| r.include?("sha256sum --check") } or abort "no checksum-verified install step"
  canary = runs.index { |r| r.include?("secret-scan.sh canary") } or abort "no canary step"
  scan = runs.index { |r| r.include?("secret-scan.sh scan") } or abort "no scan step"
  abort "steps out of order: install, canary, scan" unless install < canary && canary < scan
  checkout = steps.find { |s| s["uses"].to_s.start_with?("actions/checkout@") } or abort "no checkout"
  abort "checkout is not full depth" unless (checkout["with"] || {})["fetch-depth"] == 0
' "$workflow" 2>&1); then
  pass "secret-scan job verifies the pinned binary, runs the canary first, and swallows nothing"
else
  fail "secret-scan job shape: $shape"
fi

printf 'summary: %d passed, %d failed\n' "$pass_count" "$fail_count"
(( fail_count == 0 ))
