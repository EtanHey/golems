"""GitHub settings routes; ordinary PR/issue mutations remain unguarded."""
import re
from urllib.parse import urlsplit, unquote

BUILTINS = {'api', 'repo', 'pr', 'issue', 'release', 'run', 'workflow', 'auth', 'alias',
            'browse', 'codespace', 'completion', 'config', 'extension', 'gist', 'gpg-key',
            'label', 'org', 'project', 'search', 'secret', 'ssh-key', 'status', 'variable',
            'help', 'attestation', 'cache', 'ruleset', 'version', '--version', '--help'}


def endpoint_path(value):
    """The route gh requests: host checked, query/fragment dropped, never a dot segment."""
    if value.lower().startswith(('http://', 'https://')):
        url = urlsplit(value)
        if (url.hostname or '').lower() != 'api.github.com':
            raise ValueError('unknown GitHub API host')
        value = url.path
    path = re.sub('/+', '/', unquote(value.split('#', 1)[0].split('?', 1)[0])).strip('/')
    if any(part in ('.', '..') for part in path.split('/')):
        raise ValueError('dot segment in GitHub API route')
    return path


# gh api flags (pflag): value-taking shorthands consume the rest of their cluster or the next word.
API_SHORT = {'X': 'method', 'F': 'field', 'f': 'raw-field', 'H': 'header', 'q': 'jq', 't': 'template', 'p': 'preview'}
API_VALUE = set(API_SHORT.values()) | {'input', 'hostname', 'cache'}
API_BOOL = {'include', 'paginate', 'slurp', 'silent', 'verbose', 'help'}


def parse_api(args):
    """(method or None, positionals, [(typed, 'key=value')], input file or None) for `gh api` argv."""
    method, fields, source, positional, i, override = None, [], None, [], 0, False
    while i < len(args):
        arg = args[i]; i += 1
        if not arg.strip(): continue  # a backslash-newline continuation left as a word
        if arg[0] == '\n' and arg.lstrip('\n').startswith('-'): arg = arg.lstrip('\n')
        if arg == '--':
            positional += args[i:]; break
        pairs = []
        if arg.startswith('--'):
            name, eq, value = arg[2:].partition('=')
            if name in API_BOOL: continue
            if name not in API_VALUE: raise ValueError('unknown gh api flag')
            if not eq:
                if i >= len(args): raise ValueError('missing gh api flag value')
                value = args[i]; i += 1
            pairs.append((name, value))
        elif arg.startswith('-') and len(arg) > 1:
            j = 1
            while j < len(arg):
                char = arg[j]; j += 1
                if char == 'i': continue
                if char not in API_SHORT: raise ValueError('unknown gh api flag')
                value, j = arg[j:], len(arg)
                if value.startswith('='): value = value[1:]
                elif not value:
                    if i >= len(args): raise ValueError('missing gh api flag value')
                    value = args[i]; i += 1
                pairs.append((API_SHORT[char], value))
        else:
            positional.append(arg)
        for name, value in pairs:
            if name == 'method': method = value
            elif name == 'header' and 'override' in value.partition(':')[0].lower():
                override = True
            elif name in ('field', 'raw-field'): fields.append((name == 'field', value))
            elif name == 'input': source = value
    if not positional: raise ValueError('gh api needs an endpoint')
    # A method-override header lets the server honour another method: unknown.
    return '$OVERRIDE' if override else method, positional, fields, source


# Routine review/comment traffic. Every other GraphQL mutation needs a token.
SAFE_MUTATIONS = {
    'addComment', 'updateIssueComment', 'addPullRequestReview', 'submitPullRequestReview',
    'updatePullRequestReview', 'addPullRequestReviewComment', 'updatePullRequestReviewComment',
    'addPullRequestReviewThread', 'addPullRequestReviewThreadReply', 'resolveReviewThread',
    'unresolveReviewThread', 'addReaction', 'removeReaction', 'minimizeComment', 'unminimizeComment',
    'requestReviews', 'markPullRequestReadyForReview', 'convertPullRequestToDraft',
    'addLabelsToLabelable', 'removeLabelsFromLabelable'}
_GQL = re.compile(r'"""(?:[^"\\]|\\.|"(?!""))*"""|"(?:[^"\\\n]|\\.)*"|#[^\n]*|\.\.\.|[_A-Za-z][_0-9A-Za-z]*|[{}()\[\]:$!=@]|[^\s,]')


def mutation_fields(document):
    """Top-level field names of every mutation operation in a GraphQL document;
    None when the document cannot be read that far (fragments, bad nesting)."""
    tokens = [t for t in _GQL.findall(document.replace('\ue000', '{').replace('\ue001', '}'))
              if not t.startswith(('#', '"'))]
    names, i = [], 0

    def skip(i, open_, close):
        depth = 0
        while i < len(tokens):
            depth += (tokens[i] == open_) - (tokens[i] == close); i += 1
            if depth == 0: return i
        raise ValueError('unbalanced GraphQL')
    try:
        while i < len(tokens):
            mutation = tokens[i] == 'mutation'
            while i < len(tokens) and tokens[i] != '{':
                i = skip(i, '(', ')') if tokens[i] == '(' else i + 1
            if i == len(tokens): break
            if not mutation:
                i = skip(i, '{', '}'); continue
            i += 1
            while tokens[i] != '}':
                if tokens[i] == '...' or not re.fullmatch(r'[_A-Za-z]\w*', tokens[i]): return None
                name, i = tokens[i], i + 1
                if tokens[i] == ':': name, i = tokens[i + 1], i + 2
                names.append(name)
                while tokens[i] in ('(', '@') or tokens[i - 1] == '@':
                    i = skip(i, '(', ')') if tokens[i] == '(' else i + 1
                if tokens[i] == '{': i = skip(i, '{', '}')
            i += 1
    except (IndexError, ValueError):
        return None
    return names


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


# AIDEV-NOTE: repository writes are settings by default (lead ruling, R2 N5).
# Only routine collaboration traffic is listed; keys, branch renames, security
# features, Actions secrets/variables/permissions, pages, hooks... need a token.
# commits/<sha> has no write endpoint but its comments, so it is routine for every method.
ROUTINE = {'pulls', 'issues', 'comments', 'commits', 'statuses', 'check-runs', 'check-suites', 'dispatches', 'merges', 'forks'}
ROUTINE_ACTIONS = {'runs', 'jobs', 'caches'}  # plus workflows/<id>/dispatches
ROUTINE_GIT = {'blobs', 'trees', 'commits', 'tags'}  # plus creating a ref
ADMIN_ROOTS = {'orgs', 'user', 'teams', 'enterprises', 'admin', 'app', 'applications', 'authorizations', 'installation'}


def settings_path(path, method):
    if method in ('GET', 'HEAD', 'OPTIONS'): return False
    parts = path.split('/')
    if parts[0] == 'repos' and len(parts) >= 3:
        tail = parts[3:]
    elif parts[0] == 'repositories' and len(parts) >= 2:
        tail = parts[2:]
    else:
        return parts[0] in ADMIN_ROOTS  # account/org administration
    if not tail: return True
    if tail[0] in ROUTINE: return False
    if tail[0] == 'actions':
        return not (tail[1:2] and tail[1] in ROUTINE_ACTIONS or tail[1:2] == ['workflows'] and tail[-1] == 'dispatches')
    if tail[0] == 'git':
        return not (tail[1:2] and tail[1] in ROUTINE_GIT or tail[1:2] in (['refs'], ['ref']) and method == 'POST')
    return True


def operations(args, cwd, literal_names=frozenset(), splits=lambda word: '$' in word or '`' in word):
    while args and (args[0] in ('-R', '--repo', '--hostname') or args[0].startswith(('--repo=', '--hostname='))):
        args = args[2:] if '=' not in args[0] else args[1:]
    if not args: return []
    if args[0] not in BUILTINS or '$' in args[0] or '`' in args[0]:
        raise ValueError('unresolved GitHub CLI alias/subcommand')
    if args[0] != 'api' and any(a in ('--help', '-h') for a in args):
        return []  # help text only
    if args[:1] == ['repo']:
        if len(args) < 2: return []
        verb = args[1]
        if '$' in verb or '`' in verb or verb in ('edit', 'sync') and any('$' in a or '`' in a for a in args):
            raise ValueError('dynamic settings subcommand/options')
        guarded = (verb in ('delete', 'archive', 'unarchive', 'rename', 'edit') or  # edit: parity with the root PATCH
                   verb == 'sync' and '--force' in args or
                   verb == 'deploy-key' and any(a in ('add', 'delete') for a in args[2:]))
        if guarded:
            if any('$' in a or '`' in a for a in args): raise ValueError('dynamic settings scope')
            return [dict(class_='settings', repo=cwd, target=args[2:])]
        return []
    # Credentials and security switches outside `gh api`.
    words = set(args[1:])
    if (args[0] in ('secret', 'variable') and words & {'set', 'delete', 'remove'} or
            args[0] in ('ssh-key', 'gpg-key') and words & {'add', 'delete'} or
            args[0] == 'workflow' and 'disable' in words):
        if any('$' in a or '`' in a for a in args): raise ValueError('dynamic settings scope')
        return [dict(class_='settings', repo=cwd, target=args[:2])]
    if args[0] != 'api': return []
    method, positional, fields, source = parse_api(args[1:])
    # gh defaults to POST once it has parameters or a body file.
    method = (method or ('POST' if fields or source is not None else 'GET')).upper()
    # A shell value can become gh flags: a word led by an expansion, or any
    # expansion that may word-split, makes the method unknown (gh may send it).
    if any(a[:1] in ('$', '`') for a in positional) or any(splits(a) for a in args):
        method = '$UNKNOWN'
    endpoint = positional[0]
    if len(positional) > 1 and method not in ('GET', 'HEAD'):
        raise ValueError('gh api endpoint split across words')  # gh refuses; we cannot read the route
    body = [value for _, value in fields]
    # A typed query read from a file (`@file`, `@-`) is as opaque as --input.
    opaque = source is not None or any(typed and value.partition('=')[0] in ('query', 'operationName')
                                       and value.partition('=')[2].startswith('@') for typed, value in fields)
    if '$' in endpoint or '`' in endpoint:
        if method in ('GET', 'HEAD') and len(positional) == 1: return []  # a literal-led read
        endpoint = id_route(endpoint)
        if endpoint is None: raise ValueError('dynamic API endpoint')
    path = endpoint_path(endpoint)
    if ('$' in method or '`' in method) and any(settings_path(path, m) for m in ('PATCH', 'DELETE', 'POST', 'PUT')):
        raise ValueError('dynamic settings API method')
    guarded = settings_path(path, method)
    if path == 'graphql':
        # Mutations deny by default; routine review/comment ones pass. An opaque
        # document cannot establish that boundary.
        documents = [value.partition('=')[2] for value in body if value.partition('=')[0] == 'query']
        readings = [mutation_fields(document) for document in documents]
        guarded = opaque or any(names is None and re.search(r'\bmutation\b', document) or
                                names and not set(names) <= SAFE_MUTATIONS
                                for document, names in zip(documents, readings))
        if any(graphql_dynamic(value, literal_names) for value in body): raise ValueError('dynamic GraphQL payload')
    if guarded:
        if any('$' in a or '`' in a for a in args): raise ValueError('dynamic settings scope')
        return [dict(class_='settings', repo=cwd, target=path, method=method)]
    return []
