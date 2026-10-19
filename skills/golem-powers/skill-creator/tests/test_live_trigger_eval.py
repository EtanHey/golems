"""Offline tests for scripts/live-trigger-eval.py: mocked claude/codex/gh on PATH, no model calls."""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "live_trigger_eval", Path(__file__).parents[1] / "scripts/live-trigger-eval.py")
lte = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lte)

SKILL_DESC = {
    "pr-loop": "Open a PR, merge, ship; handle CI.",
    "agent-routing": "Dispatch a worker or reviewer.",
}


def write_skill(root, name, desc):
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f'---\nname: {name}\ndescription: "{desc}"\n---\n\n# {name}\nbody\n')
    return d


def jl(*objs):
    return "".join(json.dumps(o) + "\n" for o in objs)


def install_mock(bin_dir, name, routes, default, record=None):
    """A mock CLI: the first route whose key is a substring of the joined argv wins."""
    bin_dir.mkdir(exist_ok=True)
    spec_file = bin_dir / f"{name}.spec.json"
    spec_file.write_text(json.dumps(dict(routes=routes, default=default, record=str(record or ""))))
    script = bin_dir / name
    script.write_text(f"""#!{sys.executable}
import json, os, sys, time
spec = json.load(open({str(spec_file)!r}))
argv = ' '.join(sys.argv[1:])
if spec['record']:
    with open(spec['record'], 'a') as f:
        f.write(json.dumps(dict(argv=sys.argv[1:], env=dict(os.environ), cwd=os.getcwd())) + '\\n')
r = next((v for k, v in spec['routes'] if k in argv), spec['default'])
time.sleep(r.get('sleep', 0))
sys.stdout.write(r.get('stdout', ''))
sys.stderr.write(r.get('stderr', ''))
sys.exit(r.get('rc', 0))
""")
    script.chmod(0o755)


@pytest.fixture
def fake_home(tmp_path, monkeypatch):
    home = tmp_path / "realhome"
    for d in (".claude/skills", ".claude/agents", ".claude/commands", ".claude/projects", ".codex/skills"):
        (home / d).mkdir(parents=True)
    for s, desc in SKILL_DESC.items():
        write_skill(home / ".claude/skills", s, "OLD " + desc)
        write_skill(home / ".codex/skills", s, "OLD " + desc)
    (home / ".claude/CLAUDE.md").write_text("# global\n")
    (home / ".claude/settings.json").write_text(json.dumps(dict(
        hooks={"UserPromptSubmit": []}, mcpServers={"x": {}}, modelSettings={"m": {"effortLevel": "medium"}})))
    (home / ".codex/AGENTS.md").write_text("# codex global\n")
    (home / ".codex/config.toml").write_text('[mcp_servers.locals_t3code]\ncommand = "t3"\n')
    (home / ".codex/state.sqlite").write_text("REAL STATE")
    (home / ".codex/auth.json").write_text(json.dumps(dict(
        auth_mode="chatgpt", last_refresh=lte.iso_now(), tokens={"access_token": "x.y.z"})))
    monkeypatch.setattr(lte, "REAL_HOME", home)
    monkeypatch.setattr(lte, "claude_oauth_token", lambda: "test-token")
    return home


@pytest.fixture
def mockbin(tmp_path, monkeypatch):
    b = tmp_path / "bin"
    b.mkdir()
    install_mock(b, "gh", [], dict(rc=1, stderr="You are not logged into any GitHub hosts."))
    monkeypatch.setenv("PATH", f"{b}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("SSH_AUTH_SOCK", "/leak/ssh")
    monkeypatch.setenv("CLAUDE_CODE_MESSAGING_TOKEN", "leak")
    return b


def candidates(tmp_path):
    c = tmp_path / "cands"
    for s, desc in SKILL_DESC.items():
        write_skill(c, s, desc)
    return c


# --- ownership-checked cleanup ------------------------------------------------

def test_cleanup_refuses_preexisting_unowned_dir(tmp_path):
    victim = tmp_path / "checkout"
    (victim / ".claude").mkdir(parents=True)
    (victim / ".claude" / "settings.json").write_text("{}")
    with pytest.raises(lte.Refuse):
        lte.remove_owned(victim, "any-nonce")
    assert (victim / ".claude" / "settings.json").exists()


def test_cleanup_refuses_wrong_nonce_and_symlinked_marker(tmp_path):
    s = lte.make_scratch(tmp_path / "root", "claude")
    with pytest.raises(lte.Refuse):
        lte.remove_owned(s["path"], "not-the-nonce")
    assert s["path"].exists()
    other = tmp_path / "other"
    other.mkdir()
    (other / lte.MARKER).symlink_to(s["path"] / lte.MARKER)
    with pytest.raises(lte.Refuse):
        lte.remove_owned(other, s["nonce"])
    assert other.exists()
    lte.remove_owned(s["path"], s["nonce"])
    assert not s["path"].exists()


def test_symlinked_ancestor_is_refused_and_target_survives(tmp_path):
    target = tmp_path / "real-checkout"
    (target / ".claude").mkdir(parents=True)
    (target / ".claude" / "keep").write_text("keep")
    link = tmp_path / "link"
    link.symlink_to(target)
    with pytest.raises(lte.Refuse):
        lte.make_scratch(link, "claude")
    s = lte.make_scratch(target / "scratch-root", "claude")
    via_link = link / "scratch-root" / s["path"].name
    with pytest.raises(lte.Refuse):
        lte.remove_owned(via_link, s["nonce"])
    with pytest.raises(lte.Refuse):
        lte.remove_owned(link, s["nonce"])
    assert (target / ".claude" / "keep").read_text() == "keep"
    assert s["path"].exists()


def test_cleanup_does_not_follow_nested_symlinks(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "f").write_text("x")
    s = lte.make_scratch(tmp_path / "root", "codex")
    (s["home"] / "link").symlink_to(outside)
    lte.remove_owned(s["path"], s["nonce"])
    assert (outside / "f").read_text() == "x"


# --- scratch git isolation ----------------------------------------------------

def test_scratch_is_its_own_git_repo_without_remote(tmp_path):
    outer = tmp_path / "outer"
    outer.mkdir()
    subprocess.run(["git", "init", "-q", str(outer)], check=True)
    subprocess.run(["git", "-C", str(outer), "remote", "add", "origin", "https://github.com/EtanHey/golems"], check=True)
    s = lte.make_scratch(outer / ".worktrees", "claude")
    work = s["work"]
    top = subprocess.run(["git", "-C", str(work), "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    assert Path(top.stdout.strip()) == work
    assert subprocess.run(["git", "-C", str(work), "remote", "-v"], capture_output=True, text=True).stdout == ""
    count = subprocess.run(["git", "-C", str(work), "rev-list", "--count", "HEAD"], capture_output=True, text=True)
    assert count.stdout.strip() == "1"
    assert s["path"].name.startswith("live-trigger-claude-")


def test_git_isolation_check_refuses_dir_inside_another_worktree(tmp_path):
    outer = tmp_path / "outer"
    (outer / "sub").mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(outer)], check=True)
    with pytest.raises(lte.Refuse):
        lte.verify_git_isolation(outer / "sub", dict(PATH=os.environ["PATH"]))


def test_codex_home_holds_no_links_into_mutable_state_and_no_mcp(tmp_path, fake_home, mockbin):
    s = lte.make_scratch(tmp_path / "root", "codex")
    argv, env, prov = lte.prepare(s, "codex", ["pr-loop"], candidates(tmp_path), "gpt-test")
    ch = Path(env["CODEX_HOME"])
    assert ch.is_relative_to(s["home"]) and not ch.is_relative_to(s["work"])
    for p in ch.rglob("*"):
        if p.is_symlink():
            assert p.parent == ch / "skills", f"unexpected link {p}"
    assert not (ch / "auth.json").is_symlink()
    assert not (ch / "state.sqlite").exists()
    cfg = (ch / "config.toml").read_text()
    assert "mcp_servers" not in cfg and "apps = false" in cfg and "multi_agent = false" in cfg
    assert (ch / "skills" / "pr-loop").resolve() == (tmp_path / "cands" / "pr-loop").resolve()
    assert env["HOME"] == str(s["home"]) and "SSH_AUTH_SOCK" not in env
    assert "-s" in argv and argv[argv.index("-s") + 1] == "read-only"


def test_claude_config_is_isolated_and_restricted(tmp_path, fake_home, mockbin):
    s = lte.make_scratch(tmp_path / "root", "claude")
    argv, env, prov = lte.prepare(s, "claude", ["pr-loop"], candidates(tmp_path), "claude-test")
    cfg = Path(env["CLAUDE_CONFIG_DIR"])
    assert cfg.is_relative_to(s["home"])
    settings = json.loads((cfg / "settings.json").read_text())
    assert "hooks" not in settings and "mcpServers" not in settings
    assert settings["permissions"]["defaultMode"] == "dontAsk"
    for t in ("Edit", "Write", "NotebookEdit"):
        assert t in settings["permissions"]["deny"]
    assert "--strict-mcp-config" in argv and "--no-session-persistence" in argv
    tools = argv[argv.index("--tools") + 1].split(",")
    assert "Skill" in tools and not {"Edit", "Write", "NotebookEdit", "WebFetch"} & set(tools)
    assert (cfg / "skills" / "pr-loop").resolve() == (tmp_path / "cands" / "pr-loop").resolve()
    assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "test-token"
    assert "CLAUDE_CODE_MESSAGING_TOKEN" not in env and "SSH_AUTH_SOCK" not in env


# --- infra failures never count ----------------------------------------------

def test_claude_auth_failure_and_timeout_are_infra_not_correct(tmp_path, mockbin):
    auth = jl({"type": "system", "subtype": "init", "model": "m", "tools": ["Skill"], "mcp_servers": []},
              {"type": "result", "subtype": "success", "is_error": True, "result": "Not logged in · Please run /login"})
    install_mock(mockbin, "claude", [["slow", dict(sleep=5)]], dict(stdout=auth, rc=1))
    env = dict(PATH=os.environ["PATH"])
    r = lte.run_claude("merge it", tmp_path / "a.jsonl", [], env, tmp_path)
    assert r["status"] == "auth_error"
    r = lte.run_claude("slow one", tmp_path / "b.jsonl", [], env, tmp_path, timeout=1)
    assert r["status"] == "timeout"


def test_codex_nonzero_and_timeout_are_infra(tmp_path, mockbin):
    install_mock(mockbin, "codex", [["slow", dict(sleep=5)]],
                 dict(stdout=jl({"type": "error", "message": "401 Unauthorized"}), rc=1))
    env = dict(PATH=os.environ["PATH"])
    r = lte.run_codex("merge it", tmp_path / "a.jsonl", [], env, tmp_path, ["pr-loop"])
    assert r["status"] == "auth_error"
    r = lte.run_codex("slow", tmp_path / "b.jsonl", [], env, tmp_path, ["pr-loop"], timeout=1)
    assert r["status"] == "timeout"


def test_infra_failures_are_excluded_from_denominators():
    rows = [dict(set="trigger-evals", skill="pr-loop", should_trigger=False, status="auth_error", loaded=[], correct=None, run=1, query="q"),
            dict(set="trigger-evals", skill="pr-loop", should_trigger=False, status="ok", loaded=[], correct=True, run=2, query="q"),
            dict(set="trigger-evals", skill="pr-loop", should_trigger=True, status="timeout", loaded=[], correct=None, run=3, query="q")]
    for r in rows:
        r["correct"] = lte.score(r)
    assert [r["correct"] for r in rows] == [None, True, None]
    text = "\n".join(lte.summarize(rows, "claude", ["pr-loop"], lte.provenance("claude", "m", None), "x"))
    assert "negatives 1/1" in text and "positives 0/0" in text
    assert "infra-excluded: 2" in text


# --- Codex load detection -----------------------------------------------------

def body(name):
    return f"---\nname: {name}\ndescription: \"{SKILL_DESC.get(name, 'd')}\"\n---\n# {name}\n"


def codex_cmd(command, out, code):
    return {"type": "item.completed", "item": {"type": "command_execution", "command": command,
                                                 "aggregated_output": out, "exit_code": code,
                                                 "status": "completed" if code == 0 else "failed"}}


def test_brace_expansion():
    assert lte.expand_braces("cat a/{x,y}/S.md b") == ["cat a/x/S.md b", "cat a/y/S.md b"]
    assert lte.expand_braces("{a,{b,c}}") == ["a", "b", "c"]


def test_codex_detects_successful_brace_read_only():
    out = jl({"type": "turn.started"},
             codex_cmd("/bin/zsh -lc 'cat /h/skills/{agent-routing,pr-loop,coderabbit}/SKILL.md'",
                       body("agent-routing") + body("pr-loop") + body("coderabbit"), 0),
             codex_cmd("/bin/zsh -lc 'echo skills/large-plan/SKILL.md'", "skills/large-plan/SKILL.md\n", 0),
             codex_cmd("/bin/zsh -lc 'cat skills/x-skill/SKILL.md'", "cat: No such file\n", 1),
             codex_cmd("/bin/zsh -lc 'cat skills/large-plan/SKILL.md; rg -n x MEMORY.md'", body("large-plan"), 1),
             {"type": "turn.completed"})
    r = lte.parse_codex(out, "", 0, False, ["agent-routing", "pr-loop", "large-plan", "x-skill"])
    assert r["status"] == "ok"
    assert r["loaded"] == ["agent-routing", "pr-loop", "large-plan"]


def test_codex_counts_mcp_calls_as_side_effect_attempts():
    out = jl({"type": "item.completed", "item": {"type": "mcp_tool_call", "server": "locals_t3code", "tool": "delegate_task"}},
             {"type": "turn.completed"})
    r = lte.parse_codex(out, "", 0, False, ["pr-loop"])
    assert r["mcp_calls"] == ["locals_t3code.delegate_task"]


def test_reprocess_recomputes_codex_logs(tmp_path):
    d = tmp_path / "rec"
    d.mkdir()
    rows = [dict(set="trigger-evals", query="handle CodeRabbit", skill="pr-loop", should_trigger=True, run=1, loaded=[], correct=False),
            dict(set="trigger-evals", query="what changed", skill="pr-loop", should_trigger=False, run=2, loaded=[], correct=True)]
    (d / "results.jsonl").write_text(jl(*rows))
    (d / "run01.jsonl").write_text(jl(codex_cmd("cat skills/{agent-routing,pr-loop}/SKILL.md", body("agent-routing") + body("pr-loop"), 0),
                                      {"type": "turn.completed"}))
    (d / "run02.jsonl").write_text(jl({"type": "turn.started"}))  # never completed
    res = lte.reprocess(d, "codex", ["pr-loop", "agent-routing"])
    assert res[0]["loaded"] == ["agent-routing", "pr-loop"] and res[0]["correct"] is True
    assert res[1]["status"] == "incomplete" and res[1]["correct"] is None
    assert (d / "reprocessed-summary.md").exists() and (d / "results.jsonl").read_text() == jl(*rows)


# --- provenance ----------------------------------------------------------------

def test_codex_provenance_separates_requested_from_effective():
    p = lte.provenance("codex", "gpt-test", "low")
    rows = [dict(set="baseline", skill="pr-loop", should_trigger=True, status="ok", loaded=["pr-loop"],
                 correct=True, run=1, query="q", model_effective=None, effort_effective=None)]
    text = "\n".join(lte.summarize(rows, "codex", ["pr-loop"], p, "x"))
    assert "model_requested: gpt-test" in text
    assert "model_effective: NOT DETERMINED (model_observation_source: NOT DETERMINED)" in text
    assert "effort_effective: NOT DETERMINED" in text
    assert "session JSONL init" not in text


# --- probe ---------------------------------------------------------------------

def claude_text(text, tool=None):
    content = [{"type": "text", "text": text}]
    if tool:
        content.insert(0, {"type": "tool_use", "id": "t1", "name": tool, "input": {}})
    return jl({"type": "system", "subtype": "init", "model": "m", "tools": ["Skill"], "mcp_servers": []},
              {"type": "assistant", "message": {"content": content}},
              {"type": "result", "subtype": "success", "is_error": False, "result": text})


def good_probe_text():
    return "\n".join(f"{s}: {d}" for s, d in SKILL_DESC.items())


def test_probe_passes_clean_quote():
    ok, _, reasons = lte.check_probe(lte.parse_claude(claude_text(good_probe_text()), "", 0, False), SKILL_DESC)
    assert ok, reasons


def test_probe_rejects_tool_use():
    ok, _, reasons = lte.check_probe(lte.parse_claude(claude_text(good_probe_text(), tool="Read"), "", 0, False), SKILL_DESC)
    assert not ok and any("tool" in r for r in reasons)


def test_probe_binds_description_to_its_skill():
    swapped = f"pr-loop: {SKILL_DESC['agent-routing']}\nagent-routing: {SKILL_DESC['pr-loop']}"
    ok, rows, _ = lte.check_probe(lte.parse_claude(claude_text(swapped), "", 0, False), SKILL_DESC)
    assert not ok and not rows["pr-loop"]["in_effect"] and not rows["agent-routing"]["in_effect"]


def test_probe_rejects_failed_session():
    ok, _, reasons = lte.check_probe(lte.parse_claude("", "", 1, False), SKILL_DESC)
    assert not ok and any("status" in r for r in reasons)


def test_probe_rejects_codex_command():
    out = jl({"type": "item.completed", "item": {"type": "agent_message", "text": good_probe_text()}},
             codex_cmd("cat skills/pr-loop/SKILL.md", body("pr-loop"), 0), {"type": "turn.completed"})
    ok, _, reasons = lte.check_probe(lte.parse_codex(out, "", 0, False, list(SKILL_DESC)), SKILL_DESC)
    assert not ok


# --- end to end (mock claude) ---------------------------------------------------

def test_end_to_end_claude_run_is_isolated_and_cleans_up(tmp_path, fake_home, mockbin):
    record = tmp_path / "calls.jsonl"
    init = {"type": "system", "subtype": "init", "model": "claude-test", "mcp_servers": [],
            "tools": list(lte.CLAUDE_TOOLS)}
    probe = claude_text("\n".join(f"{s}: {d}" for s, d in SKILL_DESC.items() if s == "pr-loop"))
    iso = jl(init,
             {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "s1", "name": "Skill", "input": {"skill": "pr-loop"}}]}},
             {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "s1", "content": "Launching skill: pr-loop"}]}},
             {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "b1", "name": "Bash", "input": {"command": "touch x"}}]}},
             {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "b1", "is_error": True, "content": "Permission to use Bash has been denied."}]}},
             {"type": "result", "subtype": "success", "is_error": False, "result": "DONE"})
    hit = jl(init,
             {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "s1", "name": "Skill", "input": {"skill": "pr-loop"}}]}},
             {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "s1", "content": "Launching skill: pr-loop"}]}},
             {"type": "result", "subtype": "error_max_turns", "is_error": True})
    authfail = jl(init, {"type": "result", "subtype": "success", "is_error": True, "result": "Not logged in · Please run /login"})
    install_mock(mockbin, "claude", [["quote its description", dict(stdout=probe)],
                                     ["harness isolation check", dict(stdout=iso)],
                                     ["CI is red", dict(stdout=authfail, rc=1)]],
                 dict(stdout=hit, rc=1), record=record)
    out = tmp_path / "out"
    root = tmp_path / "root"
    lte.main(["--harness", "claude", "--skills", "pr-loop", "--sets", "baseline", "--candidates",
              str(candidates(tmp_path)), "--out", str(out), "--scratch-root", str(root), "--model", "claude-test"])
    results = [json.loads(l) for l in (out / "results.jsonl").read_text().splitlines()]
    assert [r["status"] for r in results] == ["ok", "auth_error"]
    assert results[0]["correct"] is True and results[1]["correct"] is None
    summary = (out / "summary.md").read_text()
    assert "baseline dispatch+PR 1/1" in summary and "infra-excluded: 1" in summary
    iso_rep = json.loads((out / "isolation.json").read_text())
    assert iso_rep["ok"] and iso_rep["git_remote"] == "" and iso_rep["skill_probe"]["ok"]
    assert list(root.iterdir()) == []  # scratch removed
    assert list((fake_home / ".claude/projects").iterdir()) == []  # no transcripts in the real home
    for call in map(json.loads, record.read_text().splitlines()):
        assert "SSH_AUTH_SOCK" not in call["env"] and "CLAUDE_CODE_MESSAGING_TOKEN" not in call["env"]
        assert call["env"]["HOME"] != str(fake_home)
        assert Path(call["cwd"]).name == "work"
