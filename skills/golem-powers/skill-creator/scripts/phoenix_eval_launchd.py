#!/usr/bin/env python3
"""
phoenix_eval_launchd - launchd supervisor for the local Phoenix eval stack.

The turn replay view depends on the Arize Phoenix backend. launchd starts one
long-running process, so this supervisor owns both children and lets KeepAlive
restart the pair if either side exits.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Mapping
from urllib.error import URLError
from urllib.request import urlopen


DEFAULT_BACKEND_URL = "http://127.0.0.1:6006"
DEFAULT_PROJECT_NAME = "cmux-sessions"
DEFAULT_MOBILE_HOST = "0.0.0.0"
DEFAULT_MOBILE_PORT = "6042"


class PhoenixLaunchdError(RuntimeError):
    pass


def default_working_dir() -> Path:
    return Path.home() / ".local" / "share" / "phoenix-brainlayer-eval"


def format_url_host(host: str) -> str:
    if ":" in host and not host.startswith("["):
        return f"[{host}]"
    return host


def backend_script_path() -> Path:
    value = os.environ.get("PHOENIX_BACKEND_SCRIPT")
    if not value:
        raise PhoenixLaunchdError("PHOENIX_BACKEND_SCRIPT is required")
    return Path(value).expanduser()


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PHOENIX_HOST", "127.0.0.1")
    env.setdefault("PHOENIX_PORT", "6006")
    env.setdefault("PHOENIX_WORKING_DIR", str(default_working_dir()))
    env.setdefault("PHOENIX_TELEMETRY_ENABLED", "false")
    env.setdefault("PHOENIX_DISABLE_AGENT_ASSISTANT", "true")
    env.setdefault("PHOENIX_AGENTS_DISABLE_WEB_ACCESS", "true")
    env.setdefault("PHOENIX_ALLOWED_SANDBOX_PROVIDERS", "NONE")
    env.setdefault("PHOENIX_ALLOW_EXTERNAL_RESOURCES", "false")
    return env


def backend_url(env: Mapping[str, str] | None = None) -> str:
    source = env or os.environ
    configured = source.get("PHOENIX_BASE_URL")
    if configured:
        return configured.rstrip("/")
    host = source.get("PHOENIX_HOST", "127.0.0.1")
    if host in {"0.0.0.0", "::"}:
        host = "127.0.0.1"
    port = source.get("PHOENIX_PORT", "6006")
    return f"http://{format_url_host(host)}:{port}"


def mobile_display_url(host: str, port: str) -> str:
    display_host = "localhost" if host in {"127.0.0.1", "0.0.0.0", "::"} else host
    return f"http://{format_url_host(display_host)}:{port}"


def _wait_for_backend(
    process: subprocess.Popen[bytes],
    url: str,
    *,
    timeout_s: float = 60.0,
    should_stop: Callable[[], bool] | None = None,
) -> bool:
    deadline = time.monotonic() + timeout_s
    health_url = f"{url}/v1/projects"
    while time.monotonic() < deadline:
        if should_stop and should_stop():
            return False
        if process.poll() is not None:
            if should_stop and should_stop():
                return False
            raise RuntimeError(f"Phoenix backend exited before ready with code {process.returncode}")
        try:
            with urlopen(health_url, timeout=2) as response:
                if response.status < 500:
                    return True
        except (OSError, URLError):
            pass
        time.sleep(1)
    raise RuntimeError(f"Phoenix backend did not answer {health_url} within {timeout_s:.0f}s")


def _terminate(children: list[subprocess.Popen[bytes]]) -> None:
    for child in children:
        if child.poll() is None:
            child.terminate()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline and any(child.poll() is None for child in children):
        time.sleep(0.2)
    for child in children:
        if child.poll() is None:
            child.kill()


def _monitor_children(children: list[subprocess.Popen[bytes]], should_stop: Callable[[], bool]) -> int:
    while True:
        if should_stop():
            return 0
        for child in children:
            code = child.poll()
            if code is not None:
                if should_stop():
                    return 0
                _terminate(children)
                return int(code)
        time.sleep(1)


def status_json(backend_base_url: str, mobile_host: str, mobile_port: str, project_name: str) -> str:
    return json.dumps(
        {
            "phoenix_backend": backend_base_url,
            "phoenix_mobile": mobile_display_url(mobile_host, mobile_port),
            "project_name": project_name,
        },
        sort_keys=True,
    )


def main() -> int:
    env = _env()
    try:
        backend_script = backend_script_path()
    except PhoenixLaunchdError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    backend_base_url = backend_url(env)
    mobile_script = Path(__file__).resolve().with_name("phoenix_mobile.py")
    project_name = os.environ.get("PHOENIX_PROJECT_NAME", DEFAULT_PROJECT_NAME)
    mobile_host = os.environ.get("PHOENIX_MOBILE_HOST", DEFAULT_MOBILE_HOST)
    mobile_port = os.environ.get("PHOENIX_MOBILE_PORT", DEFAULT_MOBILE_PORT)

    children: list[subprocess.Popen[bytes]] = []
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        _terminate(children)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    backend = subprocess.Popen([str(backend_script)], env=env)
    children.append(backend)
    try:
        if not _wait_for_backend(backend, backend_base_url, should_stop=lambda: stopping):
            return 0
        if stopping:
            return 0
        mobile = subprocess.Popen(
            [
                sys.executable,
                str(mobile_script),
                "--host",
                mobile_host,
                "--port",
                mobile_port,
                "--phoenix-url",
                backend_base_url,
                "--project-name",
                project_name,
            ],
            env=env,
        )
        children.append(mobile)
        if stopping:
            _terminate(children)
            return 0
        print(status_json(backend_base_url, mobile_host, mobile_port, project_name), flush=True)
        return _monitor_children(children, lambda: stopping)
    finally:
        _terminate(children)


if __name__ == "__main__":
    raise SystemExit(main())
