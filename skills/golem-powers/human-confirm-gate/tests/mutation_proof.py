from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[4]
(root / 'docs.local/human-confirm-gate').mkdir(parents=True, exist_ok=True)
gate = Path('skills/golem-powers/human-confirm-gate')
mutations = [
 ('mutable-bindings-disabled', 'commands.py', "if any(positions[i] and t in ('eval', 'source', '.', 'read', 'unset', 'export', 'declare', 'typeset', 'local', 'let', 'trap') for i, t in enumerate(tokens[:limit])):", "if False:"),
 ('issuer-public-key-disabled', '@issuer', "if not re.match(r'^(?:ssh-|ecdsa-|sk-)[^\\s]+ [A-Za-z0-9+/=]+', key.read_text()):", "if False:"),
 ('issuer-scope-disabled', '@issuer', "if not ops or any(op['class'] != args.action or not matches(op) for op in ops):", "if False:"),
 ('scope-resolution-disabled', 'commands.py', "if any(t in ('(', '&', '|', 'if', 'for', 'while', 'case') for t in tokens):", "if False:"),
 ('issuer-agent-detection-disabled', '@issuer', "    owner_terminal()", "    pass"),
 ('assignment-resolution-disabled', 'commands.py', "word = resolve_word(word, current)", "word = word"),
 ('xargs-disabled', 'commands.py', "if base == 'xargs' and any(os.path.basename(a) in ('git', 'gh', 'sh', 'bash', 'zsh') for a in args):", "if False:"),
 ('consumption-expiry-disabled', 'tokens.py', "if time.time() >= token['expires_at']:", "if False:"),
 ('redirect-disabled', 'commands.py', "if base in ('git', 'gh') and tokens[j] in ('>', '>>', '<', '<<', '<<<'):", "if False:"),
 ('classifier-disabled', 'commands.py', "    result = []\n", "    return []\n    result = []\n"),
 ('shell-wrapper-disabled', 'commands.py', "    nested = shell._shell_command_payloads(tokens, positions, segments)", "    nested = []"),
 ('rewrite-disabled', 'commands.py', "elif sub in ('filter-repo', 'filter-branch', 'replace'):", "elif sub in () :"),
 ('settings-disabled', 'commands.py', "elif base == 'gh':", "elif base == 'unused-gh':"),
 ('delete-colon-disabled', 'commands.py', "or a.startswith(('+', ':'))", "or a.startswith(('+',))"),
 ('ttl-disabled', 'tokens.py', "if not (token['issued_at'] <= now < token['expires_at'] <= token['issued_at'] + 300):", "if False:"),
 ('digest-disabled', 'tokens.py', "token['command_sha256'] != digest", "False"),
 ('scope-disabled', 'tokens.py', "token['operations'] != ops", "False"),
 ('session-disabled', 'tokens.py', "token['session_id'] != payload['session_id']", "False"),
 ('signature-disabled', 'tokens.py', "if verified.returncode:", "if False:"),
 ('mode-disabled', 'tokens.py', "stat.S_IMODE(info.st_mode) != 0o600", "False"),
 ('replay-disabled', 'tokens.py', "os.O_CREAT | os.O_EXCL | os.O_WRONLY", "os.O_CREAT | os.O_WRONLY"),
 ('collab-disabled', 'tokens.py', "if line not in collab.read_text().splitlines():", "if False:"),
 ('default-branch-disabled', 'tokens.py', "branch == default", "False"),
 ('closed-pr-disabled', 'tokens.py', "pr['state'] != 'OPEN'", "False"),
 ('merged-pr-disabled', 'tokens.py', "pr['mergedAt'] is not None", "False"),
 ('foreign-pr-disabled', 'tokens.py', "pr['isCrossRepository']", "False"),
 ('ref-disabled', 'tokens.py', "pr['headRefName'] != branch", "False"),
 ('sha-disabled', 'tokens.py', "pr['headRefOid'] != ops[0]['sha']", "False"),
 ('agent-write-disabled', 'human-confirm-pretooluse.py', "if target == protected or protected in target.parents:", "if False:"),
 ('fail-closed-disabled', 'human-confirm-pretooluse.py', "        denied = True", "        denied = False"),
]
failed = []
for name, file, old, new in mutations:
    with tempfile.TemporaryDirectory(dir=root / 'docs.local/human-confirm-gate') as tmp:
        scratch = Path(tmp)
        shutil.copytree(root / gate, scratch / gate, ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(root / 'skills/golem-powers/_shared', scratch / 'skills/golem-powers/_shared', ignore=shutil.ignore_patterns('__pycache__'))
        (scratch / 'scripts/hooks').mkdir(parents=True)
        shutil.copy(root / 'scripts/hooks/fail-open.py', scratch / 'scripts/hooks/fail-open.py')
        shutil.copy(root / 'scripts/golems-confirm', scratch / 'scripts/golems-confirm')
        (scratch / 'docs.local/human-confirm-gate').mkdir(parents=True)
        target = scratch / 'scripts/golems-confirm' if file == '@issuer' else scratch / gate / 'hooks' / file
        text = target.read_text()
        assert old in text, name
        target.write_text(text.replace(old, new, 1))
        run = subprocess.run(['python3', '-m', 'unittest', 'discover', '-s', str(gate / 'tests')], cwd=scratch, capture_output=True, text=True)
        # Syntax/import failures are not mutation proof.
        assert 'SyntaxError' not in run.stderr and 'ModuleNotFoundError' not in run.stderr, run.stderr
        killed = run.returncode != 0 and 'FAIL:' in run.stderr
        print(name, 'RED' if killed else 'SURVIVED', flush=True)
        if not killed: failed.append(name)
assert not failed, failed
