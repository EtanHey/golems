"""Shared deny policy for all golems MCP generation sinks (stdlib only)."""
import json
from pathlib import Path
import re
import sys

DENIED = {'cmuxlayer', 'cmuxlayer-mcp', 'cmuxlayer-app-server', 'cmuxlayer-proxy',
          'agent-html', 'agent-html-publisher'}
PERSONAL_LANES = {'coach', 'orc', 'orchestrator'}
DIST_SCRIPT = re.compile(r'(?:^|/)cmuxlayer/(?:[^/]+/)*dist/[^/]+\.js$')


def server_tokens(name, definition):
    values = [name]
    if isinstance(definition, dict):
        args = definition.get('args') or []
        values += [definition.get('command'), definition.get('value'),
                   *(args if isinstance(args, list) else [])]
    return [token.split('=', 1)[-1] for value in values if isinstance(value, str)
            for token in re.split(r"[\s;&|()<>`\"']+", value)]


def personal_server(name, definition):
    return any(re.search(r'(?:^|[/@_-])(?:gmail|google[-_]drive)(?:[/_.-]|$)', token)
               for token in server_tokens(name, definition))


def denied_server(name, definition):
    if name.replace('_', '-') in DENIED:
        return True
    return any(Path(token).name in DENIED or DIST_SCRIPT.search(token)
               or re.search(r'(?:^|/)agent-html/(?:.*[/.-])?(?:mcp|publisher)(?:[/.-]|$)', token)
               for token in server_tokens(name, definition))


def allowed_servers(servers, project=''):
    return {name: definition for name, definition in servers.items()
            if not denied_server(name, definition)
            and (project in PERSONAL_LANES or not personal_server(name, definition))}


def blocked_names(config):
    maps = [config.get('mcpServers') or {}, config.get('mcpDefinitions') or {},
            (config.get('global') or {}).get('mcps') or {}]
    return DENIED | {name for definitions in maps for name, definition in definitions.items()
                     if denied_server(name, definition)}


def apply_default_mcp_blocks(config):
    blocked = blocked_names(config)
    for lane, profile in (config.get('contextProfiles') or {}).items():
        if profile.get('mcps') is None:
            profile['mcps'] = {}
        mcps = profile['mcps']
        if not isinstance(mcps, dict):
            continue
        allow, block = mcps.get('allow') or [], mcps.get('block') or []
        if isinstance(allow, list):
            mcps['allow'] = [name for name in allow if name not in blocked
                             and (lane in PERSONAL_LANES or not personal_server(name,
                                  (config.get('mcpServers') or {}).get(name)))]
        if isinstance(block, list):
            mcps['block'] = list(dict.fromkeys([*block, 'cmuxlayer', *sorted(blocked - DENIED)]))


def filter_document(data, registry=False, project=''):
    if not isinstance(data, dict):
        raise ValueError('expected object')
    if registry:
        apply_default_mcp_blocks(data)
        blocked = blocked_names(data)
        global_mcps = (data.get('global') or {}).get('mcps') or {}
        personal = {name: definition for name, definition in global_mcps.items()
                    if name not in blocked and personal_server(name, definition)}
        definitions = data.setdefault('mcpDefinitions', {})
        for name, definition in personal.items():
            definitions.setdefault(name, definition)
        for lane, item in (data.get('projects') or {}).items():
            for key in ('mcps', 'mcpsLight'):
                if isinstance(item.get(key), list):
                    item[key] = [name for name in item[key] if name not in blocked
                                 and (lane in PERSONAL_LANES or not personal_server(name, definitions.get(name)))]
            if lane in PERSONAL_LANES:
                item['mcps'] = list(dict.fromkeys([*(item.get('mcps') or []), *personal]))
        if isinstance(data.get('mcpDefinitions'), dict):
            data['mcpDefinitions'] = {name: definition for name, definition in data['mcpDefinitions'].items() if name not in blocked}
        if isinstance((data.get('global') or {}).get('mcps'), dict):
            data['global']['mcps'] = {name: definition for name, definition in data['global']['mcps'].items() if name not in blocked and name not in personal}
    if isinstance(data.get('mcpServers'), dict):
        data['mcpServers'] = allowed_servers(data['mcpServers'], project)
    for lane, item in (data.get('projects') or {}).items():
        if isinstance(item, dict):
            filter_document(item, project=lane)
    return data


def main():
    # Legacy AGY configs may contain several JSON documents; preserve their count.
    text = sys.stdin.read()
    project = sys.argv[2] if len(sys.argv) > 2 else ''
    if sys.argv[1] == 'codex-blocks':
        import tomllib
        data = tomllib.loads(text)
        maps = [data.get('mcp_servers') or {}]
        maps += [p.get('mcp_servers') or {} for p in (data.get('profiles') or {}).values()]
        blocked = {name for servers in maps for name, definition in servers.items()
                   if name not in allowed_servers({name: definition}, project)}
        for name in sorted(blocked):
            if not re.fullmatch(r'[A-Za-z0-9_-]+', name):
                raise ValueError('unsupported MCP key')
            print(f'mcp_servers.{name}.enabled=false')
        return
    decoder, remaining, outputs, changed = json.JSONDecoder(), text.lstrip(), [], False
    while remaining:
        data, end = decoder.raw_decode(remaining)
        before = json.dumps(data)
        filter_document(data, registry=sys.argv[1] == 'registry', project=project)
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
