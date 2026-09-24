"""Worktree setup guidance must install dependencies, never symlink node_modules.

A worktree whose node_modules is a symlink to the main checkout's resolves
cross-package imports in a workspace monorepo (bun/npm/pnpm workspaces) to the
main checkout's packages, so the branch's own changes go untested.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SKILLS = [REPO / "skills/golem-powers/cmux-agents", REPO / "skills/golem-powers/large-plan"]
SYMLINK_NODE_MODULES = re.compile(r"ln\s+-s\S*\s+\S*node_modules")


def guidance_files():
    for skill in SKILLS:
        for path in sorted(skill.rglob("*")):
            if path.is_file() and path.suffix in {".md", ".yaml", ".yml"} and "evals" not in path.parts:
                yield path


def test_no_worktree_guidance_symlinks_node_modules():
    offenders = [
        f"{path.relative_to(REPO)}:{lineno}: {line.strip()}"
        for path in guidance_files()
        for lineno, line in enumerate(path.read_text().splitlines(), 1)
        if SYMLINK_NODE_MODULES.search(line)
    ]
    assert offenders == [], "\n".join(offenders)


def test_worktree_fallbacks_name_a_frozen_install():
    for rel in ("cmux-agents/adapters/capabilities.yaml", "large-plan/adapters/capabilities.yaml"):
        text = (REPO / "skills/golem-powers" / rel).read_text()
        assert "bun install --frozen-lockfile" in text, rel
