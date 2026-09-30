#!/usr/bin/env python3
"""Test entry point; cases and shared fixtures live in the sibling parts package."""
from _test_codex_workflows_parts.common import *  # noqa: F403
from _test_codex_workflows_parts.cases01 import Cases01 as _Cases01
from _test_codex_workflows_parts.cases02 import Cases02 as _Cases02

class CodexWorkflowPrimitiveTests(_Cases01, _Cases02, WorkflowHelpers, unittest.TestCase):
    pass

if __name__ == "__main__":
    unittest.main()
