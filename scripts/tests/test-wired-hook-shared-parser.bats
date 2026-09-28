#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TEST_ROOT="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_ROOT"
}

@test "a copy-installed tmp-block still imports the shared shell parser and passes its live probes" {
  WIRED_HOOKS_ROOT="$TEST_ROOT/hooks" run "$REPO_ROOT/skills/golem-powers/tmp-block/scripts/install.sh"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *"Install verified."* ]] &&
    [ -f "$TEST_ROOT/hooks/_shared/shell_parse.py" ] &&
    cmp -s "$TEST_ROOT/hooks/_shared/shell_parse.py" "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py" &&
    cmp -s "$TEST_ROOT/hooks/_shared/shell_parse_impl/tokens.py" "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl/tokens.py" &&
    cmp -s "$TEST_ROOT/hooks/_shared/harness_paths.py" "$REPO_ROOT/skills/golem-powers/_shared/harness_paths.py"
}

@test "copied and symlinked parser facades load their adjacent implementation copy" {
  mkdir -p "$TEST_ROOT/a" "$TEST_ROOT/b"
  cp "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py" "$TEST_ROOT/a/shell_parse.py"
  cp -R "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl" "$TEST_ROOT/a/shell_parse_impl"
  cp -R "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl" "$TEST_ROOT/b/shell_parse_impl"
  ln -s "$TEST_ROOT/a/shell_parse.py" "$TEST_ROOT/b/shell_parse.py"
  ln -s "$TEST_ROOT/a" "$TEST_ROOT/dir-link"
  python3 -c 'from pathlib import Path; import sys; p=Path(sys.argv[1]); s=p.read_text(); old="\"xargs\", \"stdbuf\", \"caffeinate\","; assert s.count(old)==1; p.write_text(s.replace(old, "\"xargs\", \"stdbuf\","))' "$TEST_ROOT/b/shell_parse_impl/tokens.py"

  cd "$TEST_ROOT"
  run python3 -I -c '
import importlib.util, pathlib, sys
root = pathlib.Path(sys.argv[1])
def load(label, path):
    spec = importlib.util.spec_from_file_location(label, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[label] = module
    spec.loader.exec_module(module)
    return module
for label, directory in (("copy", root / "a"),
                         ("directory_symlink", root / "dir-link"),
                         ("file_symlink", root / "b")):
    parser = load(label, directory / "shell_parse.py")
    impl = pathlib.Path(sys.modules[parser._shell_tokens.__module__].__file__).absolute()
    assert impl == directory / "shell_parse_impl" / "tokens.py", (label, impl)
    assert parser._shell_tokens("echo ok") == ["echo", "ok"]
first = load("first_copy", root / "a" / "shell_parse.py")
second = load("second_copy", root / "b" / "shell_parse.py")
assert second._shell_tokens is not first._shell_tokens
assert first._parse_bash("caffeinate tee /tmp/out")[1][1] is True
assert second._parse_bash("caffeinate tee /tmp/out")[1][1] is False
' "$TEST_ROOT"

  [ "$status" -eq 0 ]
}

@test "a hook dir symlinked into a hooks root (install-hooks layout) resolves the shared parser" {
  mkdir -p "$TEST_ROOT/hooks"
  ln -s "$REPO_ROOT/skills/golem-powers/tmp-block" "$TEST_ROOT/hooks/tmp-block"

  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}' | python3 '$TEST_ROOT/hooks/tmp-block/hooks/tmp-block-pretooluse.py'"

  [ "$status" -eq 0 ] && [ "$output" = "{}" ]
}

@test "a hook FILE symlinked elsewhere still resolves the shared parser via its real path" {
  ln -s "$REPO_ROOT/skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py" "$TEST_ROOT/tmp-block.py"

  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}' | python3 '$TEST_ROOT/tmp-block.py'"

  [ "$status" -eq 0 ] && [ "$output" = "{}" ]
}
