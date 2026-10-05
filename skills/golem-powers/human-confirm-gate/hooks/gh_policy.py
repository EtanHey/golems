"""GitHub settings routes; ordinary PR/issue mutations remain unguarded."""
import re
from urllib.parse import urlsplit, unquote

BUILTINS = {'api', 'repo', 'pr', 'issue', 'release', 'run', 'workflow', 'auth', 'alias',
            'browse', 'codespace', 'completion', 'config', 'extension', 'gist', 'gpg-key',
            'label', 'org', 'project', 'search', 'secret', 'ssh-key', 'status', 'variable',
            'help', 'attestation', 'cache', 'ruleset', 'version', '--version', '--help'}


def endpoint_path(value):
    if value.lower().startswith(('http://', 'https://')):
        url = urlsplit(value)
        if url.hostname.lower() != 'api.github.com':
            raise ValueError('unknown GitHub API host')
        value = url.path
    return re.sub('/+', '/', unquote(value)).strip('/')


def settings_path(path, method):
    if method in ('GET', 'HEAD', 'OPTIONS'): return False
    parts = path.split('/')
    if parts[0] == 'repos' and len(parts) >= 3:
        tail = parts[3:]
    elif parts[0] == 'repositories' and len(parts) >= 2:
        tail = parts[2:]
    elif len(parts) >= 3 and parts[0] == 'orgs':
        return parts[2] == 'rulesets'
    else:
        return False
    if not tail: return method in ('PATCH', 'DELETE') or method == 'POST'
    return (tail[0] in ('rulesets', 'collaborators', 'hooks', 'environments', 'transfer') or
            tail[:2] == ['actions', 'permissions'] or
            tail[0] == 'branches' and 'protection' in tail or
            tail[:2] in (['git', 'refs'], ['git', 'ref']) and method in ('PATCH', 'DELETE'))


def operations(args, cwd):
    while args and (args[0] in ('-R', '--repo', '--hostname') or args[0].startswith(('--repo=', '--hostname='))):
        args = args[2:] if '=' not in args[0] else args[1:]
    if not args: return []
    if args[0] not in BUILTINS or '$' in args[0] or '`' in args[0]:
        raise ValueError('unresolved GitHub CLI alias/subcommand')
    if args[:1] == ['repo']:
        if len(args) < 2: return []
        verb = args[1]
        if '$' in verb or '`' in verb or verb in ('edit', 'sync') and any('$' in a or '`' in a for a in args):
            raise ValueError('dynamic settings subcommand/options')
        guarded = (verb in ('delete', 'archive', 'rename') or
                   verb == 'sync' and '--force' in args or
                   verb == 'edit' and any(a.startswith(('--visibility', '--default-branch')) for a in args))
        if guarded:
            if any('$' in a or '`' in a for a in args): raise ValueError('dynamic settings scope')
            return [dict(class_='settings', repo=cwd, target=args[2:])]
        return []
    if args[0] != 'api': return []
    method, explicit, endpoint, body, opaque = 'GET', False, '', [], False
    i = 1
    while i < len(args):
        arg = args[i]
        if arg in ('-X', '--method'):
            i += 1; method = args[i].upper(); explicit = True
        elif arg.startswith(('-X', '--method=')):
            method = arg.split('=', 1)[-1].removeprefix('-X').upper(); explicit = True
        elif arg in ('-f', '-F', '--field', '--raw-field', '--input'):
            opaque |= arg == '--input'; i += 1; body.append(args[i])
        elif arg.startswith(('--field=', '--raw-field=', '--input=', '-f', '-F')):
            opaque |= arg.startswith('--input='); body.append(arg)
        elif arg in ('-H', '--header', '--hostname', '--jq', '-q', '--template', '-t'):
            i += 1
        elif not arg.startswith('-') and not endpoint:
            endpoint = arg
        i += 1
    if (body or opaque) and not explicit: method = 'POST'
    if '$' in endpoint or '`' in endpoint: raise ValueError('dynamic API endpoint')
    path = endpoint_path(endpoint)
    if ('$' in method or '`' in method) and any(settings_path(path, m) for m in ('PATCH', 'DELETE', 'POST')):
        raise ValueError('dynamic settings API method')
    guarded = settings_path(path, method)
    if path == 'graphql':
        # Settings/delete mutations only. PR comments and review mutations are
        # routine fleet traffic; an opaque input cannot establish that boundary.
        guarded = opaque or any(re.search(r'\bmutation\b', value) and re.search(
            r'\b(?:deleteRef|updateRef|deleteRepository|updateRepository|createRepositoryRuleset|updateRepositoryRuleset|deleteRepositoryRuleset|transferRepository)\b', value)
            for value in body)
        if any('$' in value or '`' in value for value in body): raise ValueError('dynamic GraphQL payload')
    if guarded:
        if any('$' in a or '`' in a for a in args): raise ValueError('dynamic settings scope')
        return [dict(class_='settings', repo=cwd, target=path, method=method)]
    return []
