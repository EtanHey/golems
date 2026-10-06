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


_EXPANSION = re.compile(r'\$\{[^}/]*\}|\$\([^)/]*\)|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]|`[^`/]*`')
# A shell-supplied id below one of these literal families cannot select a settings route.
ID_FAMILIES = {'pulls', 'issues', 'comments', 'reviews', 'commits', 'runs', 'jobs', 'check-runs'}


def id_route(endpoint):
    """A dynamic endpoint as a placeholder route, when every expansion is a
    whole id segment directly under an ID_FAMILIES segment of a literal
    repos/<owner>/<repo> path. Otherwise None: the route itself is unknown."""
    parts = re.sub('/+', '/', endpoint).strip('/').split('/')
    if len(parts) < 5 or parts[0] != 'repos' or any('$' in p or '`' in p for p in parts[:3]):
        return None
    for k, part in enumerate(parts):
        if '$' in part or '`' in part:
            if not _EXPANSION.fullmatch(part) or parts[k - 1] not in ID_FAMILIES:
                return None
            parts[k] = '0'
    return '/'.join(parts)


def graphql_dynamic(field, literal_names):
    """Could the shell change this field's GraphQL document? Variables are
    typed JSON values and cannot alter the operation; in the document, a
    `$name` declared as a GraphQL variable is GraphQL syntax only when every
    `$name` in the command is single-quoted (the shell never expands it)."""
    for prefix in ('--field=', '--raw-field=', '-f', '-F'):
        if field.startswith(prefix): field = field[len(prefix):]; break
    key, _, value = field.partition('=')
    if '$' in key or '`' in key: return True
    if key not in ('query', 'operationName'): return False
    declared = set(re.findall(r'\$([A-Za-z_][A-Za-z0-9_]*)\s*:', value)) & set(literal_names)
    value = re.sub(r'\$([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])', lambda m: '' if m[1] in declared else m[0], value)
    return '$' in value or '`' in value


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


def operations(args, cwd, literal_names=frozenset(), splits=lambda word: '$' in word or '`' in word):
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
    method, explicit, positional, body, opaque = 'GET', False, [], [], False
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
        elif not arg.startswith('-'):
            positional.append(arg)
        i += 1
    endpoint = positional[0] if positional else ''
    if (body or opaque) and not explicit: method = 'POST'
    # A shell value can become gh flags: a word led by an expansion, or any
    # expansion that may word-split, makes the method unknown (gh may send it).
    if any(a[:1] in ('$', '`') for a in positional) or any(splits(a) for a in args):
        method = '$UNKNOWN'
    if '$' in endpoint or '`' in endpoint:
        if method in ('GET', 'HEAD') and len(positional) == 1: return []  # a literal-led read
        endpoint = id_route(endpoint)
        if endpoint is None: raise ValueError('dynamic API endpoint')
    path = endpoint_path(endpoint)
    if ('$' in method or '`' in method) and any(settings_path(path, m) for m in ('PATCH', 'DELETE', 'POST', 'PUT')):
        raise ValueError('dynamic settings API method')
    guarded = settings_path(path, method)
    if path == 'graphql':
        # Settings/delete mutations only. PR comments and review mutations are
        # routine fleet traffic; an opaque input cannot establish that boundary.
        guarded = opaque or any(re.search(r'\bmutation\b', value) and re.search(
            r'\b(?:deleteRef|updateRef|(?:create|update|delete)(?:Repository(?:Ruleset)?|BranchProtectionRule|Environment)|(?:un)?archiveRepository|transferRepository)\b', value)
            for value in body)
        if any(graphql_dynamic(value, literal_names) for value in body): raise ValueError('dynamic GraphQL payload')
    if guarded:
        if any('$' in a or '`' in a for a in args): raise ValueError('dynamic settings scope')
        return [dict(class_='settings', repo=cwd, target=path, method=method)]
    return []
