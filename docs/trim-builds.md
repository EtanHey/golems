# Trim build output on settlement

`scripts/trim-builds <absolute-worktree-path> [--dry-run]` trims exact ignored
directories named `node_modules`, `.venv`, `venv`, `.build`, `dist`, `.next`,
`__pycache__`, `.pytest_cache`, or `DerivedData`, including nested outputs.
The main checkout is refused. No whole worktree is removed.

The command ports the closed worktree-GC branch's conservative rules: candidates
must be ignored, contain no tracked or nonignored files, Git metadata, notes,
or special files. Protected names and `.build*` prefixes are compared with
`casefold()`; Git tracked/nonignored queries use literal, case-insensitive pathspecs. Nested repositories, `docs.local`, `.git`, the whole
`.build.noindex` subtree and unknown `.build*` roots are kept. Symlink candidates
and candidates reached through a symlink parent are refused. Internal symlinks
(including dangling links and links to outside targets) are unlinked without
following them; their targets are untouched.
`lsof -nP +D` must report no descriptors; warnings, errors or timeouts refuse
removal. Checks repeat immediately before deletion. A refusal returns nonzero;
other independent candidates may already have been trimmed. This is a build-only
guard, not a check that the entire checkout is clean, pushed or merged.

Removal uses `shutil.rmtree(path, onexc=stop)` on Python 3.12+ and its
`onerror` equivalent on older Python (including CI Python 3.11), stopping at the
first error. Deletion is permanent; partial removal can occur. No Trash command runs.
Completed removals append `absolute path<TAB>allocated bytes unlinked<TAB>directory mtime`
to `<target repository main checkout>/docs.local/trim-builds/receipts.tsv`.
Bytes count `lstat().st_blocks * 512` once per removed inode, excluding file
inodes with hardlinks outside the candidate. Internal symlink targets contribute
no bytes. This records allocated blocks unlinked by actual removal, not a move
to Trash or logical file length. APFS clone/snapshot sharing and concurrent disk
activity mean exact volume free-space gain remains UNKNOWN; do not report this
field as a measured volume delta. Dry-run writes no receipts.
Dry-run stdout is readable TSV with header `path<TAB>bytes<TAB>reason`, one row
per eligible candidate. Refusals go to stderr and return nonzero; never treat an
incomplete list as approval. Before the first real use on **each Mac**, the lead
posts this dry-run list before applying. A posted list does not replace the
checks repeated by the apply invocation.
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

## Targeted verification

```sh
python3 -m unittest discover -s scripts/tests -p test_trim_builds.py
```

Fixtures use disposable repositories under `docs.local/trim-builds`. Deterministic
lsof stubs cover errors and idle/busy outcomes; a real open descriptor test also
checks the installed lsof. Tests guard against calling system Trash, including
when replayed against the old implementation. No real working tree is trimmed.
`local-run.sh` is unchanged from master; its existing scratch teardown remains
outside this command.
