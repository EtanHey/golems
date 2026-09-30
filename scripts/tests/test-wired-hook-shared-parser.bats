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

  [ "$status" -eq 0 ]
  [[ "$output" == *"Install verified."* ]]
  cmp -s "$TEST_ROOT/hooks/_shared/shell_parse.py" "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py"
  for leaf in tokens masks heredocs substitutions positions structure units function_expansion patterns conditions condition_steps variables eval_payloads expansion_state expansion data_text; do
    cmp -s "$TEST_ROOT/hooks/_shared/shell_parse_impl/$leaf.py" "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl/$leaf.py"
  done
  cmp -s "$TEST_ROOT/hooks/_shared/harness_paths.py" "$REPO_ROOT/skills/golem-powers/_shared/harness_paths.py"
}

@test "copied and symlinked parser facades load the real facade's implementation copy" {
  mkdir -p "$TEST_ROOT/a" "$TEST_ROOT/b" "$TEST_ROOT/c"
  cp "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py" "$TEST_ROOT/a/shell_parse.py"
  cp "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py" "$TEST_ROOT/c/shell_parse.py"
  cp -R "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl" "$TEST_ROOT/a/shell_parse_impl"
  cp -R "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl" "$TEST_ROOT/b/shell_parse_impl"
  cp -R "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl" "$TEST_ROOT/c/shell_parse_impl"
  ln -s "$TEST_ROOT/a/shell_parse.py" "$TEST_ROOT/b/shell_parse.py"
  ln -s "$TEST_ROOT/a" "$TEST_ROOT/dir-link"
  python3 -c 'from pathlib import Path; import sys; p=Path(sys.argv[1]); s=p.read_text(); old="\"xargs\", \"stdbuf\", \"caffeinate\","; assert s.count(old)==1; p.write_text(s.replace(old, "\"xargs\", \"stdbuf\","))' "$TEST_ROOT/c/shell_parse_impl/tokens.py"

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
    for leaf in ("tokens", "masks", "heredocs", "substitutions", "positions",
                 "structure", "units", "function_expansion", "patterns",
                 "conditions", "condition_steps", "variables", "eval_payloads", "expansion_state", "expansion", "data_text"):
        impl = pathlib.Path(sys.modules[f"{parser._IMPL_NAME}.{leaf}"].__file__).absolute()
        assert impl == (root / "a" / "shell_parse_impl" / (leaf + ".py")).resolve(), (label, leaf, impl)
    for name, leaf in (("_shell_tokens", "tokens"), ("_blank_quoted", "masks"),
                       ("_strip_heredoc_bodies", "heredocs"),
                       ("_executable_subcommands", "substitutions"),
                       ("_parse_bash", "positions")):
        impl = pathlib.Path(sys.modules[getattr(parser, name).__module__].__file__).absolute()
        assert impl == (root / "a" / "shell_parse_impl" / (leaf + ".py")).resolve(), (label, name, impl)
    assert parser._shell_tokens("echo ok") == ["echo", "ok"]
first = load("first_copy", root / "a" / "shell_parse.py")
second = load("second_copy", root / "c" / "shell_parse.py")
assert second._shell_tokens is not first._shell_tokens
assert first._parse_bash("caffeinate tee /tmp/out")[1][1] is True
assert second._parse_bash("caffeinate tee /tmp/out")[1][1] is False
' "$TEST_ROOT"

  [ "$status" -eq 0 ] || { echo "$output" >&3; false; }
}

@test "a file-symlinked facade without an adjacent package still denies a prohibited redirect" {
  mkdir -p "$TEST_ROOT/hooks/_shared" "$TEST_ROOT/hooks/tmp-block/hooks"
  ln -s "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py" "$TEST_ROOT/hooks/_shared/shell_parse.py"
  cp "$REPO_ROOT/skills/golem-powers/_shared/harness_paths.py" "$TEST_ROOT/hooks/_shared/harness_paths.py"
  cp "$REPO_ROOT/skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py" "$TEST_ROOT/hooks/tmp-block/hooks/tmp-block-pretooluse.py"

  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo hi > /tmp/parser-split-deny\"},\"cwd\":\"$TEST_ROOT\"}' | python3 '$TEST_ROOT/hooks/tmp-block/hooks/tmp-block-pretooluse.py'"

  [ "$status" -eq 2 ]
}

@test "parser package imports do not write bytecode in source or installed hook trees" {
  mkdir -p "$TEST_ROOT/source"
  cp "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py" "$TEST_ROOT/source/shell_parse.py"
  rsync -r --exclude '__pycache__' --exclude '*.pyc' "$REPO_ROOT/skills/golem-powers/_shared/shell_parse_impl/" "$TEST_ROOT/source/shell_parse_impl/"
  run env -u PYTHONDONTWRITEBYTECODE python3 -I -c 'import importlib.util,sys; p=sys.argv[1]; s=importlib.util.spec_from_file_location("source_parser",p); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); assert m._shell_tokens("echo ok") == ["echo", "ok"]; assert not sys.dont_write_bytecode' "$TEST_ROOT/source/shell_parse.py"
  [ "$status" -eq 0 ] && [ ! -d "$TEST_ROOT/source/shell_parse_impl/__pycache__" ]

  WIRED_HOOKS_ROOT="$TEST_ROOT/hooks" run "$REPO_ROOT/skills/golem-powers/tmp-block/scripts/install.sh"
  [ "$status" -eq 0 ]
  run env -u PYTHONDONTWRITEBYTECODE python3 "$TEST_ROOT/hooks/tmp-block/hooks/tmp-block-pretooluse.py" <<< '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
  [ "$status" -eq 0 ] && [ ! -d "$TEST_ROOT/hooks/_shared/shell_parse_impl/__pycache__" ]
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
