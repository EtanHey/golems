"""Compatibility entrypoint for the shared MCP deny policy."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.repogolem.mcp_policy import apply_default_mcp_blocks
