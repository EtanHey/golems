"""Trust-anchor integrity: the fingerprint pin lives in the pinned hook tree.

Public cases are class-level and built from the synthetic fixture HOME at run
time. Literal live payloads (including the retracted repro) stay in a private
docs.local corpus, exercised by test_private_corpus_if_present.
"""
import hashlib
import json
import os
import shlex
import shutil
import stat
import subprocess
import tarfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
import test_gate
from test_commands import ROOT

PRIVATE_CORPUS = ROOT.parents[2] / 'docs.local/human-confirm-anchor-integrity/private-flag-corpus.json'


class Anchor(unittest.TestCase):
    setUp = test_gate.Gate.setUp
    tearDown = test_gate.Gate.tearDown
    token = test_gate.Gate.token
    run_hook = test_gate.Gate.run_hook
    unlock = test_gate.Gate.unlock
    lock = test_gate.Gate.lock
    commit_pins = test_gate.Gate.commit_pins

    def fresh_token(self):
        return self.token(nonce=uuid.uuid4().hex)

    def rogue_rewrite(self):
        """Owner-simulated post-tamper state: a grammatical anchor naming a rogue human key."""
        rogue = self.home / 'rogue-key'
        if not rogue.exists():
            subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(rogue)], check=True)
        self.unlock()
        self.policy.write_text('human ' + rogue.with_suffix('.pub').read_text() + 'lead ' + self.lead_key.with_suffix('.pub').read_text())
        self.lock()
        self.key = rogue

    def cosmetic_rewrite(self):
        """Same keys, different bytes: every signature stays valid, only the pin differs."""
        self.unlock()
        self.policy.write_text(self.policy.read_text() + '# owner note\n')
        self.lock()

    def test_valid_pin_allows_and_tree_pin_mismatch_denies_all(self):
        self.fresh_token()
        self.assertEqual(self.run_hook()[0], 0)
        good = self.pins.read_text()
        for pins in ('', '# no fingerprints\n', 'f' * 64 + '  other-host\n', 'not-a-fingerprint\n',
                     good + 'garbage line\n', good.replace('  fixture-host', '\tfixture-host')):
            with self.subTest(pins=pins):
                self.commit_pins(pins)
                self.fresh_token()
                self.assertEqual(self.run_hook()[0], 2)
        self.commit_pins(good)
        self.pins.unlink()
        self.fresh_token()
        self.assertEqual(self.run_hook()[0], 2)

    def test_only_the_committed_pin_counts(self):
        good = self.pins.read_text()
        self.rogue_rewrite()
        rogue = hashlib.sha256(self.policy.read_bytes()).hexdigest()
        # A working-tree edit of the pinned tree (uncommitted) never re-pins.
        for text in (good + rogue + '  rogue\n', rogue + '\n'):
            with self.subTest(text=text):
                self.pins.write_text(text)
                self.fresh_token()
                self.assertEqual(self.run_hook()[0], 2)
        self.pins.write_text(good)
        git_dir = self.pins.parents[3] / '.git'
        shutil.move(git_dir, self.home / 'moved-git')  # not a checkout: deny
        try:
            self.fresh_token()
            self.assertEqual(self.run_hook()[0], 2)
        finally:
            shutil.move(self.home / 'moved-git', git_dir)

    def test_anchor_rewrite_denies_human_and_lead_tokens(self):
        from tokens import authorize
        from commands import operations
        self.cosmetic_rewrite()
        self.fresh_token()  # legitimately signed, still denied: ALL tokens
        self.assertEqual(self.run_hook()[0], 2)
        payload = dict(cwd=str(self.repo), tool_input=dict(command=self.command), session_id='worker')
        self.token('lead')
        pr = dict(state='OPEN', mergedAt=None, isCrossRepository=False, headRefName='topic', headRefOid=self.sha)
        self.assertFalse(authorize(payload, operations(self.command, str(self.repo)), self.home, lambda _: ('main', pr)))
        self.rogue_rewrite()
        self.fresh_token()  # rogue signer the rewritten anchor would admit
        self.assertEqual(self.run_hook()[0], 2)

    def test_policy_dir_rewrite_cannot_mint_tokens_even_with_a_same_dir_pin(self):
        # Outcome of the retracted class: flags cleared, anchor and an adjacent
        # pin rewritten together, flags restored. The tree pin is elsewhere.
        self.unlock()
        self.policy.write_text('human ' + self.lead_key.with_suffix('.pub').read_text())
        adjacent = self.policy.parent / 'human-confirm.anchor.sha256'
        adjacent.write_text(hashlib.sha256(self.policy.read_bytes()).hexdigest() + '\n'); adjacent.chmod(0o600)
        os.chflags(adjacent, stat.UF_IMMUTABLE)
        self.lock()
        try:
            self.key = self.lead_key
            self.fresh_token()
            self.assertEqual(self.run_hook()[0], 2)
        finally:
            os.chflags(adjacent, 0)

    def test_pin_requires_owner_review_of_principals_and_keys(self):
        from tokens import pin_anchor
        self.unlock()
        human, lead = (k.with_suffix('.pub').read_text().split() for k in (self.key, self.lead_key))
        shown = []
        self.assertEqual(len(pin_anchor(self.home, confirm=lambda lines: shown.extend(lines) or True)), 64)
        self.assertEqual([line.split()[0] for line in shown], ['human', 'lead'])
        self.assertTrue(all('SHA256:' in line for line in shown))
        self.unlock()
        with self.assertRaisesRegex(ValueError, 'not confirmed'):
            pin_anchor(self.home, confirm=lambda lines: False)
        self.assertFalse(self.policy.stat().st_flags & stat.UF_IMMUTABLE)
        valid = self.policy.read_text()
        for bad in (valid + 'agent ' + ' '.join(lead[:2]) + '\n',              # unknown principal
                    valid + 'human ' + ' '.join(lead[:2]) + '\n',              # second human key
                    'human,lead ' + ' '.join(human[:2]) + '\n',                 # shared principal key
                    'human cert-authority ' + ' '.join(human[:2]) + '\n',       # CA admits any cert
                    'human ' + human[0] + ' not-base64!\n'):
            with self.subTest(bad=bad[:40]):
                self.policy.write_text(bad)
                with self.assertRaises(ValueError):
                    pin_anchor(self.home, confirm=lambda lines: True)
                self.assertFalse(self.policy.stat().st_flags & stat.UF_IMMUTABLE)
        # The runtime enforces the same anchor grammar even when its bytes are pinned.
        self.policy.write_text(valid + 'human ' + ' '.join(lead[:2]) + '\n')
        self.commit_pins(hashlib.sha256(self.policy.read_bytes()).hexdigest() + '\n')
        self.lock()
        self.fresh_token()
        self.assertEqual(self.run_hook()[0], 2)

    def test_missing_immutable_flags_or_unsafe_metadata_deny(self):
        for path in (self.policy, self.policy.parent):
            with self.subTest(path=path.name):
                os.chflags(path, 0)
                self.fresh_token()
                self.assertEqual(self.run_hook()[0], 2)
                os.chflags(path, stat.UF_IMMUTABLE)
        self.unlock(); self.policy.parent.chmod(0o755); self.lock()
        self.fresh_token()
        self.assertEqual(self.run_hook()[0], 2)

    def test_hard_links_cannot_be_added_and_preexisting_aliases_deny(self):
        with self.assertRaises(OSError):
            os.link(self.policy, self.home / 'alias')
        self.assertEqual(self.run_hook('ln ' + shlex.quote(str(self.policy)) + ' alias')[0], 2)
        self.unlock()
        os.link(self.policy, self.home / 'alias')  # created before the owner locked
        self.lock()
        self.fresh_token()
        self.assertEqual(self.run_hook()[0], 2)

    def test_symlink_aliases_are_policy_targets_and_cannot_write(self):
        alias = self.home / 'anchor-dir-alias'; alias.symlink_to(self.policy.parent)
        with self.assertRaises(OSError):
            (alias / self.policy.name).write_text('evil')
        ancestor = shlex.quote(str(self.home / '.config'))
        for command in ('ln -s ' + shlex.quote(str(self.policy.parent)) + ' other-alias',
                        'ln -s ' + ancestor + ' cfg && cat evil >> cfg/golems/human-confirm-anchor/allowed_signers',
                        'chflags nouchg ' + shlex.quote(str(alias))):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        for tool in ('Write', 'Edit'):
            self.assertEqual(self.run_hook(tool=tool, tool_input=dict(file_path=str(alias / self.policy.name)))[0], 2)

    def test_symlinked_anchor_denies_even_with_identical_bytes(self):
        real = self.home / 'real-anchor'
        self.unlock()
        self.policy.rename(real); self.policy.symlink_to(real)
        os.chflags(real, stat.UF_IMMUTABLE); self.lock()
        try:
            self.fresh_token()
            self.assertEqual(self.run_hook()[0], 2)
        finally:
            os.chflags(real, 0)

    def test_opaque_writers_cannot_change_the_locked_anchor(self):
        source = self.home / 'evil'; source.write_text('human evil\n')
        archive = self.home / 'evil.tar'
        with tarfile.open(archive, 'w') as out: out.add(source, arcname=self.policy.name)
        anchor, folder = shlex.quote(str(self.policy)), shlex.quote(str(self.policy.parent))
        evil = shlex.quote(str(source))
        commands = {'rsync': f'rsync {evil} {anchor}', 'ditto': f'ditto {evil} {anchor}',
                    'curl -o': f'curl --silent -o {anchor} {shlex.quote(source.as_uri())}',
                    'tar -C': f'tar -xf {shlex.quote(str(archive))} -C {folder}',
                    'dd of=': f'dd if={evil} of={anchor}',
                    'find -exec rm': f'find {folder} -name allowed_signers -exec rm {{}} +',
                    'pushd': f'pushd {folder} >/dev/null; cat {evil} >> allowed_signers',
                    'mv': f'mv {evil} {anchor}'}
        original = self.policy.read_bytes()
        for route, command in commands.items():
            with self.subTest(route=route):
                self.assertEqual(self.run_hook(command)[0], 2)
                binary = shlex.split(command)[0]
                if shutil.which(binary) or binary == 'pushd':
                    # Fixture-only execution: even an erroneously allowed writer
                    # cannot change the immutable anchor.
                    subprocess.run(['/bin/bash', '-c', command], cwd=self.home, capture_output=True, timeout=10)
                self.assertEqual(self.policy.read_bytes(), original)
        self.fresh_token()
        self.assertEqual(self.run_hook()[0], 0)

    def test_flag_changes_that_could_reach_the_anchor_deny(self):
        folder = str(self.policy.parent)
        parent, name = os.path.split(folder)
        q = shlex.quote
        unresolved = {'star': parent + '/' + name[:-1] + '*', 'question': parent + '/' + name[:-1] + '?',
                      'bracket': parent + '/[' + name[0] + ']' + name[1:], 'brace': parent + '/{' + name + ',x}',
                      'nested': os.path.dirname(parent) + '/*/' + name, 'variable': '"$UNSET_TARGET"',
                      'tilde-user': '~nobody/x', 'subst': '"$(pwd)"/x'}
        for label, target in unresolved.items():
            with self.subTest(target=label): self.assertEqual(self.run_hook('chflags nouchg ' + target)[0], 2)
        literal = [f'chflags nouchg {q(folder)}', f'chflags 0 {q(str(self.policy))}',
                   f'chflags -R nouchg {q(str(self.home / ".config"))}', f'chflags -fR 0 {q(str(self.home))}',
                   'chflags nouchg ' + q(folder.replace('.config/golems', '.CONFIG/Golems')),
                   f'CHFLAGS nouchg {q(folder)}', f'/usr/bin/chflags nouchg {q(folder)}',
                   f'SetFile -a l {q(str(self.policy))}', f'xcrun SetFile -a l {q(str(self.policy))}',
                   f'timeout 5 chflags nouchg {q(folder)}', f'env chflags nouchg {q(folder)}',
                   f'F=chflags; $F nouchg {q(folder)}', f'$UNSET_EXEC nouchg {q(folder)}',
                   f'$UNSET_EXEC -R 0 {q(str(self.home / ".config"))}', './cf nouchg ' + unresolved['star'],
                   f'$UNSET_EXEC 0 {q(str(self.policy))}', f'$UNSET_EXEC nouchg {unresolved["star"]}',
                   'cd "$UNSET_DIR"; $UNSET_EXEC nouchg allowed_signers',
                   # Each isolates one rule that other layers would otherwise mask.
                   f'CHFLAGS -R 0 {q(str(self.home / ".config"))}', 'SetFile -a l ' + unresolved['star'],
                   'env -C "$UNSET_DIR" chflags 0 allowed_signers', 'timeout 5 chflags 0 allowed_signers',
                   f'T={q(folder)}; chflags nouchg $T',
                   f'echo {q(folder)} | xargs chflags nouchg', f'ls {q(folder)} | parallel chflags nouchg',
                   f'find {q(parent)} -exec chflags nouchg {{}} +', f'find {q(parent)} -execdir chflags nouchg {name} \\;',
                   f'cd {q(folder)} && chflags nouchg allowed_signers',
                   f'pushd {q(folder)}; chflags nouchg allowed_signers',
                   f'cd {q(folder)}; cd /; cd -; chflags nouchg allowed_signers',
                   f'pushd {q(folder)}; pushd /; popd; chflags nouchg allowed_signers',
                   'cd "$UNSET_DIR"; chflags nouchg allowed_signers',
                   f'env -C {q(folder)} chflags nouchg allowed_signers',
                   f'cp /usr/bin/chflags ./cf; ./cf nouchg {q(folder)}',
                   f'bash -c {q("chflags nouchg " + folder)}',
                   f'cf() {{ chflags nouchg "$1"; }}; cf {q(folder)}']
        for command in literal:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)

    def test_unrelated_commands_stay_allowed(self):
        q = shlex.quote
        for command in ('chflags nouchg disposable.txt', 'chflags nouchg "$HOME/disposable.txt"',
                        'chflags -R nouchg build', 'chflags uchg ' + q(str(self.home / 'other')),
                        'which chflags', 'man chflags', 'grep -rn chflags .', 'echo chflags nouchg x',
                        'git commit -m "chflags nouchg note"', 'kill -9 $PID', 'cut -f 2 *.csv',
                        'head -n 5 *.txt', 'rm -rf build/*', 'npm i nodemon',
                        'cat ' + q(str(self.policy)), 'ls -la ' + q(str(self.policy.parent)),
                        'cd ' + q(str(self.policy.parent)) + ' && ls',
                        'ssh-keygen -Y verify -f ' + q(str(self.policy)) + ' -I human -n golems-confirm -s x.sig < x',
                        'cat ' + q(str(self.pins)), 'shasum -a 256 ' + q(str(self.policy)),
                        '"$BIN" test "$FILE" --timeout 5000', '$PY script.py 1 *.txt', '$RUN 100 ./out',
                        'cd "$UNSET_DIR" && "$TOOL" 1 data.csv', '`which node` 5 .',
                        'ln -s . x', 'ssh-keygen -lf ' + q(str(self.policy)),
                        # At an ancestor of the pinned tree (not of the anchor), e.g. the repo root.
                        'cd ' + q(str(self.home / 'live')) + ' && ln -s . x',
                        'cd ' + q(str(self.home / 'live')) + ' && $PY script.py 1 .'):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 0)

    def test_pinned_tree_is_protected(self):
        q = shlex.quote
        tokens_py = self.hook.with_name('tokens.py')
        for command in (f'echo {"f" * 64} >> {q(str(self.pins))}', f'cp evil {q(str(self.pins))}',
                        f"sed -i '' s/a/b/ {q(str(self.pins))}", f'rm {q(str(tokens_py))}',
                        f'python3 -c pass > {q(str(tokens_py))}', f'rsync evil {q(str(self.pins))}'):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        for tool in ('Write', 'Edit', 'MultiEdit'):
            for target in (self.pins, tokens_py):
                self.assertEqual(self.run_hook(tool=tool, tool_input=dict(file_path=str(target)))[0], 2)

    def test_signature_verifier_uses_checked_snapshot(self):
        self.token()
        from tokens import authorize
        from commands import operations
        original = subprocess.run
        def inspect(argv, **kwargs):
            if '-Y' in argv and 'verify' in argv:
                self.assertTrue(argv[argv.index('-f') + 1].startswith('/dev/fd/'))
                self.assertTrue(kwargs['pass_fds'])
                self.unlock()
                self.policy.write_text('human ' + self.lead_key.with_suffix('.pub').read_text())
            return original(argv, **kwargs)
        with patch('tokens.subprocess.run', side_effect=inspect):
            self.assertTrue(authorize(dict(cwd=str(self.repo), tool_input=dict(command=self.command), session_id='worker'),
                                      operations(self.command, str(self.repo)), self.home))

    def test_private_corpus_if_present(self):
        if not PRIVATE_CORPUS.exists():
            self.skipTest('private live-payload corpus lives only in docs.local')
        corpus = json.loads(PRIVATE_CORPUS.read_text())
        for command in corpus['deny']:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        for command in corpus.get('allow', []):
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 0)


class Platform(unittest.TestCase):
    def test_unsupported_platform_refuses_before_writes_and_skips_runtime_fixtures(self):
        from tokens import pin_anchor
        with patch.object(os, 'chflags', None, create=True):
            with self.assertRaisesRegex(ValueError, 'macOS'):
                pin_anchor(Path('/synthetic-unprovisioned-home'))
            fixture = test_gate.Gate('test_denies_without_token_and_allows_normal')
            with self.assertRaises(unittest.SkipTest): fixture.setUp()

    def test_pin_is_read_from_the_named_tree_without_object_replacement(self):
        import tempfile, tokens
        root = ROOT.parents[2] / 'docs.local/human-confirm-gate'; root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as tmp:
            pins = Path(tmp) / 'tree/skills/golem-powers/human-confirm-gate/anchor.pins'
            pins.parent.mkdir(parents=True); pins.write_bytes(b'')
            seen = {}
            def fake(argv, **kwargs):
                seen.update(argv=argv, env=kwargs['env'], cwd=kwargs.get('cwd'))
                return subprocess.CompletedProcess(argv, 0, b'', b'')
            with patch('tokens.subprocess.run', side_effect=fake):
                self.assertEqual(tokens.pinned_fingerprints(pins), set())
            tree = os.path.realpath(Path(tmp) / 'tree')
            self.assertEqual(seen['argv'][1:4], ['--no-replace-objects', '-C', tree])
            self.assertEqual(seen['argv'][-1], 'HEAD:skills/golem-powers/human-confirm-gate/anchor.pins')
            self.assertEqual(seen['env'], {'PATH': '/usr/bin:/bin', 'GIT_NO_REPLACE_OBJECTS': '1',
                                           'GIT_CEILING_DIRECTORIES': os.path.dirname(tree)})
            self.assertIsNone(seen['cwd'])
            for level in pins.parents[:3]:
                with self.subTest(marker=level.name):
                    (level / '.git').write_text('x')
                    with patch('tokens.subprocess.run', side_effect=fake), self.assertRaisesRegex(ValueError, 'nested'):
                        tokens.pinned_fingerprints(pins)
                    (level / '.git').unlink()

    def test_hook_imports_put_the_stdlib_first_and_never_read_tree_bytecode(self):
        hook = ROOT / 'hooks/human-confirm-pretooluse.py'
        here, shared = os.path.realpath(ROOT / 'hooks'), os.path.realpath(ROOT.parent / '_shared')
        # Start with the tree FIRST, as `python3 hook.py` or a launcher would leave it.
        probe = ('import runpy, sys, json; sys.path[:0] = [%r, %r]; g = runpy.run_path(%r);' % (here, shared, str(hook)) +
                 'here = g["HERE"]; std = next(i for i, p in enumerate(sys.path) if p.endswith("lib-dynload") or "/lib/python3" in p);'
                 'print(json.dumps([sys.path.index(here) > std, sys.dont_write_bytecode, sys.pycache_prefix]))')
        out = subprocess.run(['python3', '-I', '-c', probe], capture_output=True, text=True, check=True).stdout
        self.assertEqual(json.loads(out), [True, True, '/dev/null/golems-human-confirm'])

    def test_compiled_file_beside_the_sources_denies_every_call(self):
        import tempfile, shutil
        root = ROOT.parents[2] / 'docs.local/human-confirm-gate'; root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as tmp:
            live = Path(tmp) / 'skills/golem-powers'
            shutil.copytree(ROOT / 'hooks', live / 'human-confirm-gate/hooks', ignore=shutil.ignore_patterns('__pycache__'))
            (live / '_shared').symlink_to(ROOT.parent / '_shared')
            hook = live / 'human-confirm-gate/hooks/human-confirm-pretooluse.py'
            payload = json.dumps(dict(tool_name='Bash', cwd=tmp, session_id='s', tool_input=dict(command='ls')))
            run = lambda: subprocess.run(['python3', '-I', '-B', str(hook)], input=payload, text=True,
                                         capture_output=True, env=dict(os.environ, HOME=tmp)).returncode
            self.assertEqual(run(), 0)
            (hook.parent / 'extra.pyc').write_bytes(b'')  # any compiled module, whatever its name
            self.assertEqual(run(), 2)

    def test_launcher_preloads_runpy_lazy_imports_before_any_hook_dir_joins(self):
        launcher = ROOT.parents[2] / 'scripts/hooks/fail-open.py'
        probe = ('import importlib.util, sys; before = [m in sys.modules for m in ("pkgutil", "warnings")];'
                 'spec = importlib.util.spec_from_file_location("launcher", %r);' % str(launcher) +
                 'mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod);'
                 'print([before, [m in sys.modules for m in ("pkgutil", "warnings")]])')
        out = subprocess.run(['python3', '-I', '-S', '-c', probe], capture_output=True, text=True, check=True).stdout
        # Loading the launcher (before main() touches sys.path) already holds runpy's lazy imports.
        self.assertEqual(out.strip(), '[[False, False], [True, True]]')

    def test_stray_importables_flag_compiled_modules_links_and_shadow_packages(self):
        import tempfile, runpy, sys
        saved = (list(sys.path), sys.pycache_prefix, sys.dont_write_bytecode)
        try:
            hook = runpy.run_path(str(ROOT / 'hooks/human-confirm-pretooluse.py'))
        finally:
            sys.path[:], sys.pycache_prefix, sys.dont_write_bytecode = saved
        root = ROOT.parents[2] / 'docs.local/human-confirm-gate'; root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as tmp:
            here, shared = Path(tmp) / 'hooks', Path(tmp) / '_shared'
            for d in (here / '__pycache__', shared / 'shell_parse_impl', shared / 'tests', shared / '__pycache__'):
                d.mkdir(parents=True)
            for f in (here / 'tokens.py', shared / 'shell_parse.py', shared / 'shell_parse_impl/units.py',
                      here / '__pycache__/tokens.cpython-313.pyc', shared / '__pycache__/x.pyc'):
                f.write_text('')
            self.assertEqual(hook['stray_importables'](str(here), str(shared)), [])
            stray = [here / 'mod.pyc', here / ('tokens' + hook['COMPILED'][0]), shared / 'shell_parse_impl/units.pyc']
            for f in stray: f.write_text('')
            (here / 'pkg').mkdir(); (shared / 'shell_parse').mkdir()
            (here / 'linked.py').symlink_to(here / 'tokens.py')
            found = set(hook['stray_importables'](str(here), str(shared)))
            self.assertEqual(found, {str(p) for p in stray + [here / 'pkg', shared / 'shell_parse', here / 'linked.py']})

    def test_pin_grammar_matches_shared_vectors(self):
        from tokens import parse_pins
        vectors = json.loads((ROOT / 'tests/pin-vectors.json').read_text())['vectors']
        for vector in vectors:
            with self.subTest(text=vector['text']):
                raw = vector['text'].encode()
                if vector['count'] is None:
                    with self.assertRaises(ValueError): parse_pins(raw)
                else:
                    self.assertEqual(len(parse_pins(raw)), vector['count'])

    def test_committed_pins_parse(self):
        from tokens import PINS, parse_pins
        self.assertEqual(PINS, ROOT / 'anchor.pins')
        parse_pins(PINS.read_bytes())  # well-formed; may be empty until the owner pins


if __name__ == '__main__':
    unittest.main()
