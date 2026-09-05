import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).parents[1] / "migrate-to-kg.py"


def load_migration_module():
    brainlayer = ModuleType("brainlayer")
    vector_store = ModuleType("brainlayer.vector_store")
    vector_store.VectorStore = object
    embeddings = ModuleType("brainlayer.embeddings")
    embeddings.get_embedding_model = lambda: None
    paths = ModuleType("brainlayer.paths")
    paths.DEFAULT_DB_PATH = Path("/tmp/brainlayer-test.db")

    modules = {
        "brainlayer": brainlayer,
        "brainlayer.vector_store": vector_store,
        "brainlayer.embeddings": embeddings,
        "brainlayer.paths": paths,
    }
    with patch.dict(sys.modules, modules):
        spec = importlib.util.spec_from_file_location("migrate_to_kg", SCRIPT_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class MigrateRootInstructionsTest(unittest.TestCase):
    def test_prefers_agents_md_for_root_digest(self):
        module = load_migration_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "packages").mkdir()
            (root / "AGENTS.md").write_text("# Shared instructions\n", encoding="utf-8")
            (root / "CLAUDE.md").write_text("@AGENTS.md\n", encoding="utf-8")
            calls = []
            module.GOLEMS_ROOT = root
            module.digest_file = lambda path, **kwargs: calls.append((path, kwargs))

            module.migrate_claude_mds()

            root_call = next(call for call in calls if call[1]["title"] == "Golems Root CLAUDE.md")
            self.assertEqual(root_call[0], root / "AGENTS.md")

    def test_falls_back_to_legacy_claude_md(self):
        module = load_migration_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "packages").mkdir()
            (root / "CLAUDE.md").write_text("# Legacy instructions\n", encoding="utf-8")
            calls = []
            module.GOLEMS_ROOT = root
            module.digest_file = lambda path, **kwargs: calls.append((path, kwargs))

            module.migrate_claude_mds()

            root_call = next(call for call in calls if call[1]["title"] == "Golems Root CLAUDE.md")
            self.assertEqual(root_call[0], root / "CLAUDE.md")


if __name__ == "__main__":
    unittest.main()
