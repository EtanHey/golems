from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"


@pytest.fixture()
def launchd_module():
    module_path = SCRIPTS_DIR / "phoenix_eval_launchd.py"
    spec = importlib.util.spec_from_file_location("phoenix_eval_launchd", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    old_module = sys.modules.get("phoenix_eval_launchd")
    sys.modules["phoenix_eval_launchd"] = module
    spec.loader.exec_module(module)
    yield module
    if old_module is None:
        sys.modules.pop("phoenix_eval_launchd", None)
    else:
        sys.modules["phoenix_eval_launchd"] = old_module


def test_backend_script_path_requires_launchd_env(launchd_module, monkeypatch):
    monkeypatch.delenv("PHOENIX_BACKEND_SCRIPT", raising=False)

    with pytest.raises(launchd_module.PhoenixLaunchdError, match="PHOENIX_BACKEND_SCRIPT"):
        launchd_module.backend_script_path()


def test_backend_script_path_expands_configured_path(launchd_module, monkeypatch):
    monkeypatch.setenv("PHOENIX_BACKEND_SCRIPT", "~/Gits/brainlayer-phoenix/scripts/start_phoenix.sh")

    assert launchd_module.backend_script_path() == Path.home() / "Gits/brainlayer-phoenix/scripts/start_phoenix.sh"


def test_backend_url_prefers_explicit_base_url(launchd_module):
    env = {
        "PHOENIX_BASE_URL": "http://127.0.0.1:7777/",
        "PHOENIX_HOST": "127.0.0.1",
        "PHOENIX_PORT": "6006",
    }

    assert launchd_module.backend_url(env) == "http://127.0.0.1:7777"


def test_backend_url_derives_from_configured_host_and_port(launchd_module):
    env = {"PHOENIX_HOST": "127.0.0.1", "PHOENIX_PORT": "6111"}

    assert launchd_module.backend_url(env) == "http://127.0.0.1:6111"


def test_backend_url_uses_loopback_for_wildcard_bind(launchd_module):
    env = {"PHOENIX_HOST": "0.0.0.0", "PHOENIX_PORT": "6222"}

    assert launchd_module.backend_url(env) == "http://127.0.0.1:6222"


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("::1", "http://[::1]:6222"),
        ("[::1]", "http://[::1]:6222"),
        ("2001:db8::1", "http://[2001:db8::1]:6222"),
    ],
)
def test_backend_url_brackets_ipv6_hosts(launchd_module, host, expected):
    env = {"PHOENIX_HOST": host, "PHOENIX_PORT": "6222"}

    assert launchd_module.backend_url(env) == expected


def test_launchd_mobile_host_default_preserves_server_wildcard_bind(launchd_module):
    assert launchd_module.DEFAULT_MOBILE_HOST == "0.0.0.0"


@pytest.mark.parametrize("host", ["127.0.0.1", "0.0.0.0", "::"])
def test_mobile_display_url_uses_localhost_for_local_binds(launchd_module, host):
    assert launchd_module.mobile_display_url(host, "6042") == "http://localhost:6042"


def test_mobile_display_url_uses_configured_reachable_host(launchd_module):
    assert launchd_module.mobile_display_url("10.0.0.5", "6042") == "http://10.0.0.5:6042"


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("::1", "http://[::1]:6042"),
        ("[::1]", "http://[::1]:6042"),
        ("2001:db8::1", "http://[2001:db8::1]:6042"),
    ],
)
def test_mobile_display_url_brackets_ipv6_hosts(launchd_module, host, expected):
    assert launchd_module.mobile_display_url(host, "6042") == expected


def test_wait_for_backend_returns_false_when_stop_requested(launchd_module):
    class FakeProcess:
        returncode = None

        def poll(self):
            return None

    assert (
        launchd_module._wait_for_backend(
            FakeProcess(),
            "http://127.0.0.1:6006",
            timeout_s=0.1,
            should_stop=lambda: True,
        )
        is False
    )


def test_wait_for_backend_retries_probe_timeout(launchd_module, monkeypatch):
    class FakeProcess:
        returncode = None

        def poll(self):
            return None

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    calls = []

    def fake_urlopen(_url, timeout):
        calls.append(timeout)
        if len(calls) == 1:
            raise TimeoutError("slow startup")
        return FakeResponse()

    monkeypatch.setattr(launchd_module, "urlopen", fake_urlopen)
    monkeypatch.setattr(launchd_module.time, "sleep", lambda _seconds: None)

    assert launchd_module._wait_for_backend(FakeProcess(), "http://127.0.0.1:6006") is True
    assert calls == [2, 2]


def test_monitor_children_returns_zero_when_stop_races_with_child_exit(launchd_module, monkeypatch):
    class FakeProcess:
        def poll(self):
            return 143

    stop_checks = 0
    terminate_calls = []

    def should_stop():
        nonlocal stop_checks
        stop_checks += 1
        return stop_checks > 1

    monkeypatch.setattr(launchd_module, "_terminate", lambda children: terminate_calls.append(children))

    assert launchd_module._monitor_children([FakeProcess()], should_stop) == 0
    assert terminate_calls == []


def test_monitor_children_returns_child_code_for_unexpected_exit(launchd_module, monkeypatch):
    class FakeProcess:
        def poll(self):
            return 7

    terminate_calls = []
    monkeypatch.setattr(launchd_module, "_terminate", lambda children: terminate_calls.append(children))

    children = [FakeProcess()]
    assert launchd_module._monitor_children(children, lambda: False) == 7
    assert terminate_calls == [children]


def test_status_json_is_parseable_and_reports_display_url(launchd_module):
    payload = json.loads(
        launchd_module.status_json(
            "http://127.0.0.1:6006",
            "0.0.0.0",
            "6042",
            "cmux-sessions",
        )
    )

    assert payload == {
        "phoenix_backend": "http://127.0.0.1:6006",
        "phoenix_mobile": "http://localhost:6042",
        "project_name": "cmux-sessions",
    }


def test_default_phoenix_working_dir_uses_current_home(launchd_module, tmp_path, monkeypatch):
    monkeypatch.delenv("PHOENIX_WORKING_DIR", raising=False)
    monkeypatch.setattr(launchd_module.Path, "home", staticmethod(lambda: tmp_path))

    assert launchd_module._env()["PHOENIX_WORKING_DIR"] == str(
        tmp_path / ".local/share/phoenix-brainlayer-eval"
    )
