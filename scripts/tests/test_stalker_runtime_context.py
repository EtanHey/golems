import ast
import builtins
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / 'scripts/stalker/stalker-runtime-context.py'
SUFFIX = '.local/state/golems/stalker/admission.sqlite3'
CHILD = """import importlib.util,sys
from types import SimpleNamespace
s=importlib.util.spec_from_file_location('context',sys.argv[1])
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
home,mode=sys.argv[2:4]
def account(uid):
    if mode=='error': raise KeyError('PRIVATE_ACCOUNT')
    return SimpleNamespace(pw_dir=home)
m.getpwuid=account
sys.argv=[sys.argv[1],*sys.argv[4:]]
sys.exit(m.main())
"""


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='p2b1-', dir=ROOT / 'scripts/tests')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.home = self.root / 'account'
        self.home.mkdir()
        self.metadata = self.root / 'metadata.json'
        for name in ('video.ts', 'chat.log', 'ledger.sqlite', 'metadata.json'):
            (self.root / name).write_bytes(b'PRIVATE_SENTINEL\x00\xff')
        self.original = self.snapshot()
        self.addCleanup(lambda: self.assertEqual(self.original, self.snapshot(self.original)))
        self.api = self.load(CORE)
        self.account = mock.patch.object(self.api, 'getpwuid', return_value=SimpleNamespace(pw_dir=str(self.home)))
        self.lookup = self.account.start()
        self.addCleanup(self.account.stop)

    def load(self, path):
        spec = importlib.util.spec_from_file_location('fixture_api', path)
        api = importlib.util.module_from_spec(spec)
        def guarded_import(name, *args, **kwargs):
            if name.split('.')[0] in {'subprocess', 'socket', 'urllib', 'http', 'yt_dlp', 'sqlite3'}:
                raise AssertionError('forbidden context import')
            return builtins.__import__(name, *args, **kwargs)
        api.__dict__['__builtins__'] = dict(vars(builtins), __import__=guarded_import)
        spec.loader.exec_module(api)
        return api

    def snapshot(self, names=None):
        paths = [self.root / n for n in names] if names is not None else self.root.rglob('*')
        return {str(p.relative_to(self.root)): ('dir' if p.is_dir() else
                (p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest())) for p in paths}

    def call(self, function, *args):
        before = self.snapshot()
        try:
            return function(*args)
        finally:
            self.assertEqual(before, self.snapshot())

    def metadata_for(self, platform='twitch', **changes):
        data = dict(extractor_key='TwitchStream', id='123456789', display_id='theo', uploader_id='theo',
                    is_live=True, live_status='is_live') if platform == 'twitch' else dict(
                    extractor_key='Youtube', id='aB3_dE5-fG7', uploader_id='@theo', is_live=True, live_status='is_live')
        return data | changes

    def identity(self, platform='twitch', channel='ThEo', **changes):
        data = self.metadata_for(platform, **changes)
        before = json.dumps(data, sort_keys=True)
        result = self.call(self.api.capture_identity, platform, channel, data)
        self.assertEqual(before, json.dumps(data, sort_keys=True))
        return result

    def reject(self, platform='twitch', channel='theo', **changes):
        with self.assertRaises(self.api.Invalid):
            self.identity(platform, channel, **changes)

    def cli(self, args=None, raw=None, code=0, reason='CONTEXT_ONLY', account='ok', direct=False):
        payload = json.dumps(self.metadata_for()) if raw is None else raw
        self.metadata.write_bytes(payload if isinstance(payload, bytes) else payload.encode())
        self.original['metadata.json'] = self.snapshot(['metadata.json'])['metadata.json']
        args = ['prepare-capture', '--platform', 'twitch', '--channel', 'ThEo', '--metadata', str(self.metadata)] if args is None else args
        command = [sys.executable, str(CORE)] if direct else [sys.executable, '-c', CHILD, str(CORE), str(self.home), account]
        before = self.snapshot()
        run = subprocess.run(command + args, capture_output=True, text=True)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(run.returncode, code, run.stderr)
        self.assertEqual(run.stdout if code else run.stderr, '')
        result = json.loads(run.stderr if code else run.stdout)
        self.assertIs(result['authorized'], False)
        self.assertEqual(result['reason'], reason)
        if code:
            self.assertEqual(set(result), {'contextVersion', 'authorized', 'reason'})
        self.assertEqual(result['contextVersion'], 1)
        self.assertNotIn('PRIVATE', run.stdout + run.stderr)
        return result

    def test_1_canonical_path_across_roots_and_environments(self):
        for name in ('checkout', 'worktree', 'release'):
            cwd = self.root / name
            cwd.mkdir()
            previous = Path.cwd()
            try:
                os.chdir(cwd)
                with mock.patch.dict(os.environ, HOME=str(cwd), XDG_STATE_HOME=str(cwd), GOLEMS_ROOT=str(cwd),
                                     STALKER_DB=str(cwd / 'stray.db'), STALKER_SPOOL=str(cwd)):
                    self.assertEqual(self.call(self.api.canonical_db), self.home / SUFFIX)
            finally:
                os.chdir(previous)
        self.lookup.assert_called_with(os.getuid())

    def test_2_account_alias_and_errors(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.home, target_is_directory=True)
        with mock.patch.object(self.api, 'getpwuid', return_value=SimpleNamespace(pw_dir=str(alias))):
            self.assertEqual(self.call(self.api.canonical_db), self.home / SUFFIX)
        for home in ('relative', '', None, '/bad\x00home'):
            with mock.patch.object(self.api, 'getpwuid', return_value=SimpleNamespace(pw_dir=home)):
                with self.assertRaises(self.api.AccountError):
                    self.call(self.api.canonical_db)
        for error in (KeyError('PRIVATE'), OSError('PRIVATE')):
            with mock.patch.object(self.api, 'getpwuid', side_effect=error):
                with self.assertRaises(self.api.AccountError):
                    self.call(self.api.canonical_db)
        self.cli(code=73, reason='ACCOUNT_ERROR', account='error')

    def test_3_twitch_identity_and_fallback_refusals(self):
        result = self.identity()
        self.assertEqual(result, dict(platform='twitch', channel='theo', broadcastId='123456789', captureUrl='https://www.twitch.tv/theo'))
        self.assertEqual(result, self.identity(timestamp=111, path='/PRIVATE', url='https://PRIVATE?signed=PRIVATE'))
        self.assertNotEqual(result, self.identity(id='987654321'))
        for value in ('theo', '123theo', 'v123', '', '0', '000', 123, True, None, ' 123', '123 ', '１２３'):
            self.reject(id=value)
        self.reject(channel='123', id='123', display_id='123', uploader_id='123')
        for changes in ({'extractor_key': 'TwitchVod'}, {'display_id': 'other'}, {'uploader_id': None}):
            self.reject(**changes)
        for channel in ('@theo', 'theo-name', 'theo/name', '', None):
            self.reject(channel=channel)
        self.reject(platform='other')

    def test_4_youtube_live_identity_and_indirection(self):
        result = self.identity('youtube')
        self.assertEqual(result, dict(platform='youtube', channel='theo', broadcastId='aB3_dE5-fG7', captureUrl='https://www.youtube.com/watch?v=aB3_dE5-fG7'))
        self.assertNotEqual(result, self.identity('youtube', id='zB3_dE5-fG7'))
        for platform in ('twitch', 'youtube'):
            for changes in ({'is_live': False}, {'is_live': 1}, {'is_live': None}, {'live_status': None},
                            *({'live_status': s} for s in ('is_upcoming', 'was_live', 'post_live', 'not_live')),
                            *({'_type': s} for s in ('playlist', 'url', 'url_transparent')), {'entries': []}):
                self.reject(platform, **changes)
            data = self.metadata_for(platform)
            for key in ('is_live', 'live_status'):
                with self.assertRaises(self.api.Invalid):
                    self.call(self.api.capture_identity, platform, 'theo', {k: v for k, v in data.items() if k != key})
        for changes in ({'id': 'short'}, {'id': 'a' * 12}, {'id': 'a' * 10 + '!'}, {'id': 123}, {'id': True},
                        {'id': None}, {'uploader_id': '@other'}, {'uploader_id': None}, {'uploader_id': 'theo'}, {'extractor_key': 'YoutubeTab'}):
            self.reject('youtube', **changes)

    def test_5_cli_import_equivalence_and_closed_projection(self):
        for platform in ('twitch', 'youtube'):
            data = self.metadata_for(platform, secret='PRIVATE', url='https://PRIVATE?signed=PRIVATE')
            args = ['prepare-capture', '--platform', platform, '--channel', 'ThEo', '--metadata', str(self.metadata)]
            result = self.cli(args, raw=json.dumps(data))
            self.assertEqual(result, dict(contextVersion=1, authorized=False, reason='CONTEXT_ONLY', canonicalDb=str(self.home / SUFFIX),
                                         identity=self.identity(platform), coverageStatus='unknown'))
        direct = self.cli(direct=True)
        self.assertEqual(direct['identity'], self.identity())
        self.assertTrue(Path(direct['canonicalDb']).is_absolute())

    def test_6_json_parser_io_and_no_write_errors(self):
        for raw in ('{', '{"id":', '{"n":' + '9' * 5000 + '}', '[]', 'null', '1', '"PRIVATE"'):
            self.cli(raw=raw, code=64, reason='INVALID_JSON' if raw.startswith('{') else 'INVALID_IDENTITY')
        self.cli(raw=b'\xffPRIVATE', code=64, reason='INVALID_JSON')
        for args in ([], ['PRIVATE'], ['prepare-capture'], ['prepare-capture', '--platform', 'PRIVATE']):
            self.cli(args, code=64, reason='INVALID_ARGUMENTS', direct=True)
        self.cli(raw=json.dumps(self.metadata_for(is_live=False)), code=64, reason='INVALID_IDENTITY')
        for path in (self.root / 'missing', self.root):
            self.cli(['prepare-capture', '--platform', 'twitch', '--channel', 'theo', '--metadata', str(path)], code=73, reason='METADATA_IO')

    def test_7_preservation_and_no_authority_surfaces(self):
        for command in ('admit', 'finish', 'recover', 'inspect'):
            self.cli([command], code=64, reason='INVALID_ARGUMENTS')
        args = ['prepare-capture', '--platform', 'twitch', '--channel', 'theo', '--metadata', str(self.metadata)]
        self.cli(args + ['--db', 'PRIVATE'], code=64, reason='INVALID_ARGUMENTS')
        self.assertFalse(any(hasattr(self.api, name) for name in ('admit', 'finish', 'recover', 'claim', 'reservation')))
        tree = ast.parse(CORE.read_text())
        imports = {n.module.split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        imports |= {a.name.split('.')[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
        self.assertLessEqual(imports, {'argparse', 'json', 'os', 'pathlib', 'pwd', 're', 'sys'})
        self.assertFalse({'system', 'popen', 'spawn', 'exec', 'eval'} & {getattr(n.func, 'attr', getattr(n.func, 'id', '')) for n in ast.walk(tree) if isinstance(n, ast.Call)})

    def test_8_test_only_composition_with_unchanged_p2a(self):
        spec = importlib.util.spec_from_file_location('admission', ROOT / 'scripts/stalker/stalker-admission.py')
        admission = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(admission)
        identity = self.identity()
        request = dict(schemaVersion=1, kind='capture', jobKey='fixture', spool=str(self.root), expectedBytes=10,
                       temporaryBytes=2, derivedBytes=3, reserveBytes=5, **{k: identity[k] for k in ('platform', 'channel', 'broadcastId')})
        code, result = admission.admit(self.root / 'composition.sqlite', request, observe=lambda p: (1, 20))
        self.assertEqual(code, 0)
        self.assertTrue(result['authorized'])
        self.assertEqual(result['coverageStatus'], 'unknown')
        self.assertEqual(admission.admit(self.root / 'composition.sqlite', request)[1]['reason'], 'REPLAY')


if __name__ == '__main__':
    unittest.main()
