import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

class ConventionRoleTest(unittest.TestCase):
    def test_worker_pin_comes_from_stable_implementation_role(self):
        script = Path(__file__).resolve().parents[1]/'convention_audit.py'
        spec = importlib.util.spec_from_file_location('role_audit', script)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        root = Path(__file__).resolve().parents[5]
        expected = subprocess.check_output(['node',str(root/'scripts/model-roles.mjs'),'codex.implement','--stable'],text=True).strip()
        command = module.build_codex_command(codex_binary='fixture',repo=root,output_schema=Path('/synthetic/schema'),effort='xhigh')
        self.assertEqual(command[command.index('-m')+1], expected)
        with patch.dict(os.environ, {'GOLEMS_MODEL_ROLES_ROOT': str(root/'missing-root')}):
            with self.assertRaises(RuntimeError): module.build_codex_command(codex_binary='fixture',repo=root,output_schema=Path('/synthetic/schema'),effort='xhigh')

    def test_registry_edits_propagate_without_reimport(self):
        import json, shutil, tempfile
        script = Path(__file__).resolve().parents[1]/'convention_audit.py'
        spec = importlib.util.spec_from_file_location('role_propagation_audit', script)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        root = Path(__file__).resolve().parents[5]
        with tempfile.TemporaryDirectory(prefix='.role-test-', dir=Path(__file__).parent) as temp:
            fixture = Path(temp)
            for name in ['scripts/model-roles.mjs', 'scripts/ci/check-model-role-drift.mjs', 'standards/model-roles.json', 'standards/model-roles.schema.json']:
                dest = fixture/name; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(root/name, dest)
            path = fixture/'standards/model-roles.json'; roles = json.loads(path.read_text())
            with patch.dict(os.environ, {'GOLEMS_MODEL_ROLES_ROOT': str(fixture)}):
                for model in ['synthetic-worker-one', 'synthetic-worker-two']:
                    roles['roles']['codex.implement']['model'] = model; path.write_text(json.dumps(roles))
                    command = module.build_codex_command(codex_binary='fixture',repo=fixture,output_schema=Path('/synthetic/schema'),effort='xhigh')
                    self.assertEqual(command[command.index('-m')+1], model)
