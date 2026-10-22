"""Shared deny policy for all golems MCP generation sinks (stdlib only)."""
import json
from pathlib import Path
import re
import sys

DENIED = {'cmuxlayer', 'cmuxlayer-mcp', 'cmuxlayer-app-server', 'cmuxlayer-proxy'}
DIST_SCRIPT = re.compile(r'(?:^|/)cmuxlayer/(?:[^/]+/)*dist/[^/]+\.js$')


def denied_server(name, definition):
    if name in DENIED:
        return True
    if not isinstance(definition, dict):
        return False
    args = definition.get('args') or []
    values = [definition.get('command'), *(args if isinstance(args, list) else [])]
    for value in values:
        if not isinstance(value, str):
            continue
        for token in re.split(r"[\s;&|()<>`\"']+", value):
            token = token.split('=', 1)[-1]
            if Path(token).name in DENIED or DIST_SCRIPT.search(token):
                return True
    return False


def allowed_servers(servers):
    return {name: definition for name, definition in servers.items()
            if not denied_server(name, definition)}


def blocked_names(config):
    maps = [config.get('mcpServers') or {}, config.get('mcpDefinitions') or {},
            (config.get('global') or {}).get('mcps') or {}]
    return DENIED | {name for definitions in maps for name, definition in definitions.items()
                     if denied_server(name, definition)}


def apply_default_mcp_blocks(config):
    blocked = blocked_names(config)
    for profile in (config.get('contextProfiles') or {}).values():
        if profile.get('mcps') is None:
            profile['mcps'] = {}
        mcps = profile['mcps']
        if not isinstance(mcps, dict):
            continue
        allow, block = mcps.get('allow') or [], mcps.get('block') or []
        if isinstance(allow, list):
            mcps['allow'] = [name for name in allow if name not in blocked]
        if isinstance(block, list):
            mcps['block'] = list(dict.fromkeys([*block, 'cmuxlayer', *sorted(blocked - DENIED)]))


def filter_document(data, registry=False):
    if not isinstance(data, dict):
        raise ValueError('expected object')
    if registry:
        apply_default_mcp_blocks(data)
        blocked = blocked_names(data)
        for project in (data.get('projects') or {}).values():
            for key in ('mcps', 'mcpsLight'):
                if isinstance(project.get(key), list):
                    project[key] = [name for name in project[key] if name not in blocked]
        if isinstance(data.get('mcpDefinitions'), dict):
            data['mcpDefinitions'] = {name: definition for name, definition in data['mcpDefinitions'].items() if name not in blocked}
        if isinstance((data.get('global') or {}).get('mcps'), dict):
            data['global']['mcps'] = {name: definition for name, definition in data['global']['mcps'].items() if name not in blocked}
    if isinstance(data.get('mcpServers'), dict):
        data['mcpServers'] = allowed_servers(data['mcpServers'])
    for project in (data.get('projects') or {}).values():
        if isinstance(project, dict):
            filter_document(project)
    return data


def main():
    # Legacy AGY configs may contain several JSON documents; preserve their count.
    text = sys.stdin.read()
    decoder, remaining, outputs, changed = json.JSONDecoder(), text.lstrip(), [], False
    while remaining:
        data, end = decoder.raw_decode(remaining)
        before = json.dumps(data)
        filter_document(data, registry=sys.argv[1] == 'registry')
        changed |= json.dumps(data) != before
        outputs.append(json.dumps(data))
        remaining = remaining[end:].lstrip()
    if not outputs:
        raise ValueError('empty config')
    sys.stdout.write('\n'.join(outputs) + '\n' if changed else text)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('repoGolem: MCP deny policy failed; refusing unfiltered config', file=sys.stderr)
        sys.exit(1)
