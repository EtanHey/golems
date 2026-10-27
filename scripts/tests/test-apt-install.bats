#!/usr/bin/env bats

setup() {
  HELPER="$BATS_TEST_DIRNAME/../ci/apt-install.sh"
  export APT_SOURCES_DIR="$BATS_TEST_TMPDIR/apt" CI_APT_COMMAND_TIMEOUT=1
  export APT_TEST_LOG="$BATS_TEST_TMPDIR/calls" APT_TEST_MODE=success
  export APT_TEST_CHILD_PID="$BATS_TEST_TMPDIR/child.pid"
  mkdir -p "$APT_SOURCES_DIR/sources.list.d" "$BATS_TEST_TMPDIR/bin"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  cat > "$BATS_TEST_TMPDIR/bin/apt-get" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$APT_TEST_LOG"
case "$*" in
  *update)
    count=$(grep -c 'update$' "$APT_TEST_LOG")
    if [[ $APT_TEST_MODE == hang && $count == 1 ]]; then
      sleep 300 &
      sleeper=$!
      echo "$sleeper" > "$APT_TEST_CHILD_PID"
      trap 'wait "$sleeper" || true; echo terminated >> "$APT_TEST_LOG"; exit 143' TERM
      while :; do sleep 0.1; done
    fi
    if [[ $APT_TEST_MODE == hang && $count == 2 ]]; then
      grep -q 'URIs: http://archive.ubuntu.com/ubuntu' "$APT_SOURCES_DIR/sources.list.d/ubuntu.sources" || exit 44
    fi
    [[ $APT_TEST_MODE != fail ]] || exit 42
    ;;
  *install*) [[ $APT_TEST_MODE != install-fail ]] || exit 43 ;;
esac
STUB
  chmod +x "$BATS_TEST_TMPDIR/bin/apt-get"
  cat > "$BATS_TEST_TMPDIR/bin/dpkg" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$APT_TEST_LOG.dpkg"
exit 17
STUB
  chmod +x "$BATS_TEST_TMPDIR/bin/dpkg"
}

deb822_sources() {
  cat > "$APT_SOURCES_DIR/sources.list.d/ubuntu.sources" <<'SOURCES'
Types: deb
URIs: mirror+file:/etc/apt/mirrors/ubuntu.list
Suites: noble noble-updates noble-backports
Components: main universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: mirror+file:/etc/apt/mirrors/ubuntu-security.list
Suites: noble-security
Components: main universe
SOURCES
}

@test "hung apt is terminated, then deb822 switches and succeeds on attempt two" {
  deb822_sources
  export APT_TEST_MODE=hang
  run bash "$HELPER" bats zsh ripgrep ffmpeg
  [ "$status" -eq 0 ]
  grep -qx terminated "$APT_TEST_LOG"
  [ -s "$APT_TEST_CHILD_PID" ]
  ! kill -0 "$(cat "$APT_TEST_CHILD_PID")" 2>/dev/null || false
  [ "$(grep -c 'update$' "$APT_TEST_LOG")" -eq 2 ]
  grep -q 'URIs: http://archive.ubuntu.com/ubuntu' "$APT_SOURCES_DIR/sources.list.d/ubuntu.sources"
  grep -q 'URIs: http://security.ubuntu.com/ubuntu' "$APT_SOURCES_DIR/sources.list.d/ubuntu.sources"
  grep -q 'Signed-By:' "$APT_SOURCES_DIR/sources.list.d/ubuntu.sources"
  [[ $output == *'attempt 1 failed (124)'* ]] || false
  [[ $output == *'source=direct-archive'* ]] || false
  grep -q 'Acquire::http::Timeout=20.*Acquire::https::Timeout=20.*install -y --no-install-recommends bats zsh ripgrep ffmpeg' "$APT_TEST_LOG"
}

@test "three failures switch legacy sources and return nonzero without a fourth attempt" {
  printf '%s\n' 'deb http://azure.archive.ubuntu.com/ubuntu noble main' \
    'deb-src mirror+file:/etc/apt/mirrors/ubuntu-security.list noble-security main' \
    '# preserve comment' > "$APT_SOURCES_DIR/sources.list"
  export APT_TEST_MODE=fail
  run bash "$HELPER" bats
  [ "$status" -eq 42 ]
  [ "$(grep -c 'update$' "$APT_TEST_LOG")" -eq 3 ]
  [ "$(grep -cx -- '--configure -a' "$APT_TEST_LOG.dpkg")" -eq 2 ]
  grep -qx 'deb http://archive.ubuntu.com/ubuntu noble main' "$APT_SOURCES_DIR/sources.list"
  grep -qx 'deb-src http://security.ubuntu.com/ubuntu noble-security main' "$APT_SOURCES_DIR/sources.list"
  grep -qx '# preserve comment' "$APT_SOURCES_DIR/sources.list"
}

@test "install failures are bounded too, and first-attempt success keeps original sources" {
  deb822_sources
  run bash "$HELPER" bats
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$APT_TEST_LOG" | tr -d ' ')" -eq 2 ]
  grep -q 'mirror+file:' "$APT_SOURCES_DIR/sources.list.d/ubuntu.sources"
  rm "$APT_TEST_LOG"
  export APT_TEST_MODE=install-fail
  run bash "$HELPER" bats
  [ "$status" -eq 43 ]
  [ "$(grep -c 'install ' "$APT_TEST_LOG")" -eq 3 ]
}

@test "missing sources files fail clearly before a second apt attempt" {
  export APT_TEST_MODE=fail
  run bash "$HELPER" bats
  [ "$status" -ne 0 ]
  [[ $output == *'apt: source switch failed: no sources file found'* ]] || false
  [ "$(grep -c 'update$' "$APT_TEST_LOG")" -eq 1 ]
}
