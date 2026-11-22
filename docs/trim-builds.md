# Trim build output on settlement

`scripts/trim-builds <absolute-worktree-path> [--dry-run]` trims exact ignored
directories named `node_modules`, `.venv`, `venv`, `.build`, `dist`, `.next`,
`__pycache__`, `.pytest_cache`, or `DerivedData`, including nested outputs.
The main checkout is refused. No whole worktree is removed.

The command ports the closed worktree-GC branch's conservative rules: candidates
must be ignored, contain no tracked or nonignored files, Git metadata, notes,
special files or symlinks. Nested repositories, `docs.local`, `.git`, the whole
`.build.noindex` subtree and unknown `.build*` roots are kept. Symlink candidates
are refused, including aliases within the tree. No directory aliases are followed.
`lsof -nP +D` must report no descriptors; warnings, errors or timeouts refuse
removal. Checks repeat immediately before deletion. A refusal returns nonzero;
other independent candidates may already have been trimmed. This is a build-only
guard, not a check that the entire checkout is clean, pushed or merged.

Removal uses `/usr/bin/trash` when installed. Otherwise Python `shutil.rmtree`
stops at the first error (permanent deletion; partial removal can occur).
Completed removals append `absolute path<TAB>logical file bytes<TAB>directory mtime`
to `<target repository main checkout>/docs.local/trim-builds/receipts.tsv`.
Logical bytes are not an allocated-space measurement. Dry-run writes no receipts.
The receipt is locked and opened before removal, flushed/fsynced after it. An
interruption or write error after removal can leave a missing receipt; neither
this nor lsof prevents a concurrent writer from starting after the final check.
Run only after producers have stopped. This is not filesystem fencing.

## Register in T3 (lead applies after merge)

In official T3 Code nightly, add this script to the project's root `t3.json`
`scripts` array (merge with existing entries; do not replace other settings):

```json
{
  "scripts": [
    {
      "name": "Trim build output",
      "command": "\"$T3CODE_PROJECT_ROOT/scripts/trim-builds\" \"${T3CODE_WORKTREE_PATH:?worktree required}\"",
      "runOnSettle": true,
      "stopOnSettle": false
    }
  ]
}
```

For a project without this command in its own checkout, use the absolute path to
the installed golems main checkout's `scripts/trim-builds` in `command`.
Do not register multiple settle scripts: T3 selects the **first** one with
`runOnSettle: true`; combine with an existing settle command if necessary.
Project settings overrides can supersede `project.scripts`; check the effective
project scripts in T3 after registration. This PR changes no project config.

Source checked locally (not proof of installed T3 behavior):
`apps/server/src/orchestration-v2/ThreadSettlementService.ts:756-805` closes
terminals and invokes the project's settle script only for an existing, owned
worktree. Root-checkout threads and children sharing their parent's worktree
skip it. `project/ProjectSetupScriptRunner.ts:494-518` selects the settle script
and passes `projectScriptRuntimeEnv` from `packages/shared/src/projectScripts.ts`:
`T3CODE_PROJECT_ROOT` is the project root and `T3CODE_WORKTREE_PATH` the thread's
worktree. `packages/contracts/src/t3ProjectFile.ts` defines `t3.json` and
`runOnSettle`. Settlement is distinct from a provider run simply ending.

## Ratchet scratch lifecycle

`local-run.sh` uses a linked execution checkout of a separate scratch main clone.
Its EXIT trap calls trim on success and failure, also with `--keep`. A trim refusal
retains scratch and logs the refusal. Receipts are copied into the durable run
directory before the existing scratch teardown; the original run exit status is
preserved. Evidence under `docs.local` stays outside the trim allowlist.

## Targeted verification

```sh
python3 -m unittest discover -s scripts/tests -p test_trim_builds.py
```

Fixtures use disposable repositories under `docs.local/trim-builds`. Deterministic
lsof stubs cover errors and idle/busy outcomes; a real open descriptor test also
checks the installed lsof. No real working tree is trimmed by the tests.
