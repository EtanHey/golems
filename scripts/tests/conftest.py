"""Make workspace CLI sibling modules importable for direct module tests."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "workspace"))
