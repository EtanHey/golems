#!/usr/bin/env python3
"""Two copies of the digest bridge must resolve their own data modules."""
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile


SOURCE = Path(__file__).resolve().parents[1] / "stalker/brain-delivery"


def load_render(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with tempfile.TemporaryDirectory(prefix="brain-delivery-copies-") as directory:
    root = Path(directory)
    first, second = root / "first", root / "second"
    for target in (first, second):
        target.mkdir()
        for filename in ("digest-render.py", "digest-data.py"):
            shutil.copyfile(SOURCE / filename, target / filename)

    # A name-based import would keep the first implementation for both copies.
    with (second / "digest-data.py").open("a") as stream:
        stream.write('\ndef copy_identity(): return "second"\n')
    before_path = list(sys.path)
    original_override = os.environ.pop("STALKER_DIGEST_DATA_PATH", None)
    try:
        render_a = load_render(first / "digest-render.py", "render_copy_a")
        render_b = load_render(second / "digest-render.py", "render_copy_b")
        data_a = render_a._load_data_module()
        data_b = render_b._load_data_module()
        assert data_a is not data_b
        assert data_a.DigestData is not data_b.DigestData
        assert not hasattr(data_a, "copy_identity")
        assert data_b.copy_identity() == "second"
        assert render_a._load_data_module() is data_a
        assert render_b._load_data_module() is data_b
        assert sys.path == before_path

        # The shell's stdin execution needs the explicit real-path override.
        os.environ["STALKER_DIGEST_DATA_PATH"] = str(first / "digest-data.py")
        assert render_b._load_data_module() is data_a
    finally:
        if original_override is None:
            os.environ.pop("STALKER_DIGEST_DATA_PATH", None)
        else:
            os.environ["STALKER_DIGEST_DATA_PATH"] = original_override

print("brain delivery two-copy isolation: PASS")
