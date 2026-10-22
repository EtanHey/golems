#!/usr/bin/env python3
"""Read-only cmuxlayer registration/process check. Python 3.11+ required."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tomllib

BINS = {'cmuxlayer', 'cmuxlayer-mcp', 'cmuxlayer-app-server', 'cmuxlayer-proxy'}
DIST_SCRIPT = re.compile(r'(?:^|/)cmuxlayer/(?:[^/]+/)*dist/[^/]+\.js$')
# Host maintenance duties from cmuxlayer's resource-guard dispatcher, not MCP servers.
HOST_DUTY_SCRIPTS = {'resource-guard.js', 'mcp-reaper.js'}


def references_cmuxlayer(value):
    tokens = re.split(r"[\s;&|()<>`\"']+", value)
    return any(Path(token).name in BINS or DIST_SCRIPT.search(token) for token in tokens)


def is_cmuxlayer_command(command):
    try:
        args = shlex.split(command)
    except ValueError:
        return False
    if not args:
        return False
    executable = Path(args[0]).name
    if executable in BINS:
        return True
    if executable not in {'node', 'nodejs'}:
        return False
    # Only node's entrypoint counts, never a later argument to another script.
    remaining = iter(args[1:])
    for arg in remaining:
        if arg in {'-e', '--eval', '-p', '--print'} or arg.startswith(('--eval=', '--print=')):
            return False
        if arg in {'-r', '--require', '--import', '--loader', '--inspect-port', '--title',
                   '--conditions', '-C', '--env-file', '--redirect-warnings',
                   '--diagnostic-dir', '--icu-data-dir', '--openssl-config'}:
            next(remaining, None)
            continue
        if arg == '--':
            arg = next(remaining, '')
        elif arg.startswith('-'):
            continue
        return bool(DIST_SCRIPT.search(arg)) and Path(arg).name not in HOST_DUTY_SCRIPTS
    return False


def registrations(data, prefix=''):
    """Inspect registration fields, ignoring project paths, block lists and prose."""
    if not isinstance(data, dict):
        return
    for field in ('mcpServers', 'mcp_servers'):
        servers = data.get(field, {})
        if isinstance(servers, dict):
            for key, server in servers.items():
                references = False
                if isinstance(server, dict):
                    argv = server.get('args') or []
                    values = [server.get('command'), *(argv if isinstance(argv, list) else [])]
                    references = any(isinstance(value, str) and references_cmuxlayer(value) for value in values)
                if key in BINS or references:
                    yield f'{prefix}{field}.{key}'
    enabled = data.get('enabledMcpjsonServers', [])
    if isinstance(enabled, list):
        for key in enabled:
            if isinstance(key, str) and key in BINS:
                yield f'{prefix}enabledMcpjsonServers.{key}'
    projects = data.get('projects', {})
    if isinstance(projects, dict):
        for project, settings in projects.items():
            yield from registrations(settings, f'{prefix}projects[{project}].')


def check(home, process_list=None):
    paths = {home / p for p in ('.claude.json', '.claude/.mcp.json',
             '.codex/config.toml', '.cursor/mcp.json', '.gemini/settings.json',
             '.gemini/config/mcp_config.json')}
    paths.update((home / '.claude').glob('settings*.json'))
    paths.update((home / 'Gits').glob('*/.mcp.json'))
    findings = []
    for path in sorted(paths):
        try:
            text = path.read_text()
        except FileNotFoundError:
            continue
        except OSError:
            findings.append(f'RED: cannot inspect {path}')
            continue
        try:
            data = tomllib.loads(text) if path.suffix == '.toml' else json.loads(text)
            if not isinstance(data, dict):
                raise ValueError('expected object')
        except ValueError:
            findings.append(f'RED: cannot inspect {path} (invalid config)')
            continue
        # Codex trust/project tables are never MCP registrations.
        if path.suffix == '.toml':
            data = {'mcp_servers': data.get('mcp_servers', {})}
        findings.extend(f'RED: {path} server={key}' for key in registrations(data))
    try:
        processes = (process_list.read_text() if process_list is not None else
                     subprocess.check_output(['ps', '-ww', '-axo', 'pid=,args='], text=True))
        for line in processes.splitlines():
            match = re.match(r'\s*(\d+)\s+(.+)', line)
            if match and is_cmuxlayer_command(match[2]):
                findings.append(f'RED: pid={match[1]} {match[2]}')
    except (OSError, subprocess.CalledProcessError):
        findings.append('RED: cannot inspect process list')
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, default=Path(os.environ['HOME']),
                        help='config root (defaults to HOME)')
    parser.add_argument('--process-list', type=Path, help='fixture ps output: pid args')
    args = parser.parse_args()
    findings = check(args.home, args.process_list)
    print('\n'.join(findings) if findings else 'GREEN: cmuxlayer absent (no MCP registrations or server processes)')
    return int(bool(findings))


if __name__ == '__main__':
    raise SystemExit(main())
