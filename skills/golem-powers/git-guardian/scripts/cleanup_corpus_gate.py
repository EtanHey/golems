"""Opt-in, decision-only cleanup compatibility gate. Retain hashes, never argv."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re


def fingerprint(cwd, command):
    return hashlib.sha256((cwd + '\0' + command).encode()).hexdigest()


def _commands(source):
    for line in reversed(source.read_text(errors='replace').splitlines()):
        try:
            record = json.loads(line)
        except ValueError:
            continue
        message = record.get('message') or {}
        content = message.get('content') if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict) and item.get('type') == 'tool_use' and item.get('name') == 'Bash':
                command = (item.get('input') or {}).get('command')
                if isinstance(command, str):
                    yield record.get('cwd') or os.path.expanduser('~'), command


def capture(sources, count=200):
    pattern = re.compile(r'(?:^|[\s;&|(`$])(rm|find|rsync)\s')
    seen, entries, rows = set(), [], []
    for source in sources:
        for cwd, command in _commands(source):
            if command in seen or not pattern.search(command):
                continue
            if '-delete' not in command and 'rsync' not in command and not re.search(r'\brm\b[^\n;|&]*\s-[A-Za-z]*[rR]|--recursive', command):
                continue
            seen.add(command)
            rows.append((cwd, command))
            entries.append({'source': str(source.resolve()), 'identity': fingerprint(cwd, command)})
            if len(rows) == count:
                return {'version': 1, 'entries': entries}, rows
    raise ValueError('insufficient unique cleanup commands')


def replay(snapshot):
    if snapshot.get('version') != 1:
        raise ValueError('unsupported snapshot version')
    by_source = {}
    for entry in snapshot['entries']:
        by_source.setdefault(entry['source'], set()).add(entry['identity'])
    found = {}
    for source, wanted in by_source.items():
        for row in _commands(Path(source)):
            identity = fingerprint(*row)
            if identity in wanted:
                found[identity] = row
    for entry in snapshot['entries']:
        if entry['identity'] not in found:
            raise ValueError('frozen corpus row missing or changed')
        yield found[entry['identity']]


def audit(rows, baseline, candidate, true_positives):
    baseline_denies = candidate_denies = total = 0
    new_denies, unclassified = [], []
    for cwd, command in rows:
        total += 1
        old, new = bool(baseline(command, cwd)), bool(candidate(command, cwd))
        baseline_denies += old
        candidate_denies += new
        if new and not old:
            identity = fingerprint(cwd, command)
            new_denies.append(identity)
            evidence = true_positives.get(identity, {})
            if not all(isinstance(evidence.get(key), str) and evidence[key].strip()
                       for key in ('reason', 'evidence')):
                unclassified.append(identity)
    return {'total': total, 'baseline_denies': baseline_denies,
            'candidate_denies': candidate_denies, 'new_denies': new_denies,
            'unclassified_new_denies': len(unclassified), 'unclassified': unclassified}


def _classifier(path):
    spec = importlib.util.spec_from_file_location('corpus_' + hashlib.sha256(str(path).encode()).hexdigest(), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return lambda command, cwd: module.dangerous_shell_reason(command, cwd=cwd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-projects', type=Path)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--baseline-lib', type=Path, required=True)
    parser.add_argument('--candidate-lib', type=Path, required=True)
    parser.add_argument('--true-positives', type=Path)
    args = parser.parse_args()
    if args.capture_projects:
        sources = sorted(args.capture_projects.glob('*/*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)[:400]
        snapshot, rows = capture(sources)
        args.snapshot.write_text(json.dumps(snapshot, indent=2) + '\n')
    else:
        rows = replay(json.loads(args.snapshot.read_text()))
    positives = json.loads(args.true_positives.read_text()) if args.true_positives else {}
    result = audit(rows, _classifier(args.baseline_lib), _classifier(args.candidate_lib), positives)
    if result['total'] != 200:
        raise ValueError('corpus gate requires exactly 200 frozen commands')
    print(json.dumps(result, indent=2))
    return bool(result['unclassified_new_denies'])


if __name__ == '__main__':
    raise SystemExit(main())
