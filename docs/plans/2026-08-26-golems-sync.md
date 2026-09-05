# Golems Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a checkout-free, idempotent command that installs golems skills and the repoGolem launcher on another Mac.

**Architecture:** A Bash entrypoint validates the source checkout and runtime payload, then uses a small transport abstraction for either SSH/rsync or a local test root. Remote-side mutations are performed by a shipped helper so production and tests share backup, symlink, manifest, and drift behavior.

**Tech Stack:** Bash/zsh, rsync, SSH, Bats, Python 3.

---

### Task 1: Lock the command contract with RED tests

**Files:**
- Create: `scripts/tests/test-golems-sync.bats`

1. Add a local-host fixture with a minimal skill payload and launcher pair.
2. Add tests for dry-run non-mutation, runtime coupling rejection, backup and
   symlink creation, idempotent second run, and launcher hash equality.
3. Run `bats scripts/tests/test-golems-sync.bats` and confirm failure because
   `scripts/golems-sync.sh` does not exist.

### Task 2: Make codex-workflows portable

**Files:**
- Modify: `skills/golem-powers/codex-workflows/tests/test_codex_workflows.py`
- Modify: `skills/golem-powers/codex-workflows/scripts/codex_workflows.py`
- Modify documentation or evaluation fixtures containing executable hard-coded paths as needed.

1. Add tests proving `CODEX_BIN` resolves from `PATH` and the default runs root
   derives from `Path.home()`.
2. Run the focused Python tests and confirm the new assertions fail against the
   current literals.
3. Replace the literals with environment-aware `PATH` and home resolution.
4. Run the focused tests until green.

### Task 3: Implement synchronization

**Files:**
- Create: `scripts/golems-sync.sh`
- Create: `scripts/repogolem/golems-sync-install.sh`

1. Parse `<host>`, `--dry-run`, `--only`, and `--allow-dirty`.
2. Enforce clean `master == origin/master` unless explicitly overridden and
   print the shipped commit.
3. Materialize the selected commit with `git archive`, excluding all ignored,
   untracked, and dirty working-tree files from the transport payload.
4. Reject unapproved coupling in every shipped skill file outside `docs/` and
   `README*`, using exact file/token exceptions with one-line reasons.
5. Stage skills and launcher files, then invoke the helper locally or over SSH.
6. In the helper, mirror only the owned skill root, back up copied entries,
   create owned links, install and hash-check the launcher, and write the JSON
   manifest.
7. Run the Bats suite after each behavior until all focused tests pass.

### Task 4: Verify and prove

**Files:**
- Modify if needed: `scripts/tests/test-golems-sync.bats`

1. Run shell syntax checks and the focused Bats/Python/launcher tests.
2. Run the full `bun test` suite and separate pre-existing failures from branch
   regressions.
3. Run the command twice against the local shim to verify unchanged second-run
   behavior.
4. Run the dry-run and apply against `m1`, then collect symlink, manifest,
   launcher hash, and Python import receipts.

### Task 5: PR and review handoff

**Files:**
- Create/update: the orchestrator handoff report for this sync (private repo; path supplied at dispatch)
- Create/update: the cmux agent report at the engine-issued `report_path`

1. Run the local CodeRabbit gate, commit with the required agent trailer, push,
   and create a signed ready-for-review PR.
2. Put the real M1 receipts in the PR body.
3. Write `STATUS: REVIEW_NEEDED` reports so orc can spawn the required Claude
   reviewer; do not merge from the worker lane.
