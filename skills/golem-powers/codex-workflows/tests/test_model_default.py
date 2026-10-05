import importlib.util
import json
import os
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[4]
ENTRY = Path(__file__).resolve().parents[1] / 'scripts/codex_workflows.py'
spec = importlib.util.spec_from_file_location('model_default_workflows', ENTRY)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

class RoleDefaultTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory(prefix='.model-default-', dir=Path(__file__).parent)
        self.root = Path(self.tmp.name)
        for path in ['scripts/model-roles.mjs', 'scripts/ci/check-model-role-drift.mjs', 'standards/model-roles.json', 'standards/model-roles.schema.json']:
            dest = self.root / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(REPO / path, dest)
        self.env = patch.dict(os.environ, {'GOLEMS_MODEL_ROLES_ROOT': str(self.root)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.tmp.cleanup)
    def default_spec(self):
        brief = self.root / 'brief.md'; brief.write_text('Synthetic brief')
        return {'repo': str(self.root), 'lead': 'synthetic', 'workers': [{'name': 'one', 'brief': str(brief)}]}
    def set_role(self, model, candidate=False):
        path = self.root / 'standards/model-roles.json'; data = json.loads(path.read_text())
        data['roles']['codex.implement']['model'] = model
        if candidate: data['roles']['codex.implement']['status'] = 'candidate'
        path.write_text(json.dumps(data))
    def test_role_changes_propagate_to_compositions_and_agent_launch(self):
        for model in ['synthetic-one', 'synthetic-two']:
            self.set_role(model)
            self.assertEqual(w.validate_composition_spec(self.default_spec(), pipeline=False)['model'], model)
            captured = []
            # Exercise CLI dispatch without creating a worker or using a provider.
            original = w.launch_worker
            w.launch_worker = lambda **kwargs: captured.append(kwargs) or {'ok': True}
            try:
                w.main(['agent', '--repo', str(self.root), '--name', 'one', '--brief', str(self.root/'brief.md'), '--lead', 'synthetic', '--run-id', model, '--run-dir', str(self.root/'runs')])
            finally: w.launch_worker = original
            self.assertEqual(captured[0]['model'], model)
    def test_missing_or_candidate_registry_fails_closed_but_explicit_override_works(self):
        self.set_role('unbenched', candidate=True)
        with self.assertRaises(w.CodexWorkflowError): w.validate_composition_spec(self.default_spec(), pipeline=False)
        (self.root/'standards/model-roles.json').unlink()
        with self.assertRaises(w.CodexWorkflowError): w.validate_composition_spec(self.default_spec(), pipeline=False)
        spec = self.default_spec(); spec['model'] = 'explicit-model'
        self.assertEqual(w.validate_composition_spec(spec, pipeline=False)['model'], 'explicit-model')

    def test_all_worker_overrides_do_not_require_default_registry(self):
        (self.root/'standards/model-roles.json').unlink()
        spec = self.default_spec(); spec['workers'][0]['model'] = 'explicit-worker'
        self.assertEqual(w.validate_composition_spec(spec, pipeline=False)['workers'][0]['model'], 'explicit-worker')
        pipeline = {'repo': spec['repo'], 'lead': spec['lead'], 'stages': [{'name': 'stage', 'workers': spec['workers']}]}
        self.assertEqual(w.validate_composition_spec(pipeline, pipeline=True)['stages'][0]['workers'][0]['model'], 'explicit-worker')
