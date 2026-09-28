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
# stderr, then exits STUB_RC, whatever its arguments.
stub="$suite_root/stub-trufflehog"
cat > "$stub" <<'STUB'
#!/usr/bin/env bash
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
  "" "$error_log" 0 'encountered errors during scan'
expect_scan "findings without the --fail exit status fail as a tool error" 2 "$finding" "$info_log" 0
expect_scan "the --fail exit status without findings fails as a tool error" 2 "" "$info_log" 183
expect_scan "output that is not JSON fails as a tool error" 2 "not json" "$info_log" 0

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
