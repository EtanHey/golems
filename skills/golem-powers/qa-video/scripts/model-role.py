#!/usr/bin/env python3
"""Resolve a concrete model using the gatherer's checkout/release config lookup."""
import importlib.util
import json
from pathlib import Path
import sys


def main():
    spec = importlib.util.spec_from_file_location('visual', Path(__file__).with_name('visual-gather.py'))
    visual = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(visual)
    path = visual.roles_file()
    try:
        model = json.loads(path.read_text())['roles'][sys.argv[1]]['model']
        if not isinstance(model, str) or not model.strip():
            raise ValueError('expected non-empty concrete model ID')
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError(f'invalid model role {sys.argv[1]} in {path}: {error}') from None
    print(model)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('usage: model-role.py <role>')
        main()
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
