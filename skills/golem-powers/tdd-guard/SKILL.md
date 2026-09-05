---
name: tdd-guard
description: "TDD edit-limit hook. Triggers: tdd guard, test-first hook, untested implementation block, snapshot/golden carve-out."
hooks:
  PreToolUse:
    - hook: hooks/tdd-guard.py
      description: Block implementation files edited 3+ times without a matching test.
---

# tdd-guard - versioned TDD enforcement hook

Hook-carried skill. The enforcing artifact is `hooks/tdd-guard.py`
(PreToolUse on `Write|Edit`); this page is its contract and verification guide.

## Scope

A PreToolUse hook on Write/Edit. The limits apply to implementation files.

## Contract

- Implementation files (`.ts`, `.tsx`, `.kt`, `.swift`, `.py`) are tracked per
  session.
- Existing implementation files edited 1-2 times without a matching test emit a
  warning.
- Existing implementation files edited 3+ times without a matching test are
  blocked.
- Test files, docs/config/generated paths, hooks, scripts, skills, and skipped
  path segments are not classified as implementation.

## Snapshot/golden carve-out

Snapshot, golden, and approval artifacts are test data, not implementation.
`hooks/tdd-guard.py` excludes:

- `__snapshots__/` via `SKIP_PATH_SEGMENTS`
- Dotted marker filenames via `is_snapshot_file()`: `.snap.`, `.golden.`,
  `.snapshot.`, `.approved.`, `.received.`, plus files ending in `.snap`

The marker match is intentionally precise. Names such as `golden_retriever.ts`
and `snapshot_service.ts` remain implementation files and still hit the recall
gate when edited 3+ times without a test.

## Tests

`hooks/tests/test_tdd_guard.py` pins:

- snapshot/golden/approval artifacts are allowed after three edits
- a real `Service.ts` implementation file still blocks after three untested edits
- marker words embedded inside real implementation filenames are not carved out

Run:

```bash
$(brew --prefix)/bin/python3 -m pytest hooks/tests/ -q
```
