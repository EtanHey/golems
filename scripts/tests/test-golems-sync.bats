#!/usr/bin/env bats

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    # shellcheck source=../lib/portable-stat.sh
    source "$REPO_ROOT/scripts/lib/portable-stat.sh"
    SYNC_SCRIPT="$REPO_ROOT/scripts/golems-sync.sh"
    HOST_ROOT="$BATS_TEST_TMPDIR/host-home"
    SKILLS_SOURCE="$BATS_TEST_TMPDIR/skills/golem-powers"

    mkdir -p "$SKILLS_SOURCE/alpha" "$SKILLS_SOURCE/beta"
    printf '# Alpha\n' > "$SKILLS_SOURCE/alpha/SKILL.md"
    printf '# Beta\n' > "$SKILLS_SOURCE/beta/SKILL.md"
}

run_sync() {
    run env \
        HOST_SHELL=local \
        HOST_ROOT="$HOST_ROOT" \
        GOLEMS_SYNC_SKILLS_SOURCE="$SKILLS_SOURCE" \
        "$SYNC_SCRIPT" local --allow-dirty "$@"
    return 0
}

make_fixture_repo() {
    FIXTURE_REPO="$BATS_TEST_TMPDIR/source-repo"
    mkdir -p "$FIXTURE_REPO/scripts/repogolem" \
        "$FIXTURE_REPO/skills/golem-powers/alpha" \
        "$FIXTURE_REPO/skills/golem-powers/beta"
    cp "$SYNC_SCRIPT" "$FIXTURE_REPO/scripts/golems-sync.sh"
    cp "$REPO_ROOT/scripts/repogolem/golems-sync-install.sh" \
        "$REPO_ROOT/scripts/repogolem/golem-dispatch.zsh" \
        "$REPO_ROOT/scripts/repogolem/install-golem-dispatch.sh" \
        "$FIXTURE_REPO/scripts/repogolem/"
    if [[ -f "$REPO_ROOT/scripts/golems-sync-coupling-allowlist.tsv" ]]; then
        cp "$REPO_ROOT/scripts/golems-sync-coupling-allowlist.tsv" "$FIXTURE_REPO/scripts/"
    fi
    printf '# Alpha\n' > "$FIXTURE_REPO/skills/golem-powers/alpha/SKILL.md"
    printf '# Beta\n' > "$FIXTURE_REPO/skills/golem-powers/beta/SKILL.md"
    printf 'skills/golem-powers/**/secret.json\n*.pyc\n' > "$FIXTURE_REPO/.gitignore"
    chmod +x "$FIXTURE_REPO/scripts/golems-sync.sh" \
        "$FIXTURE_REPO/scripts/repogolem/golems-sync-install.sh" \
        "$FIXTURE_REPO/scripts/repogolem/golem-dispatch.zsh" \
        "$FIXTURE_REPO/scripts/repogolem/install-golem-dispatch.sh"
    git init --quiet --initial-branch=master "$FIXTURE_REPO"
    git -C "$FIXTURE_REPO" config user.email test@example.com
    git -C "$FIXTURE_REPO" config user.name Test
    git -C "$FIXTURE_REPO" add .
    git -C "$FIXTURE_REPO" commit --quiet -m fixture
    git -C "$FIXTURE_REPO" update-ref refs/remotes/origin/master HEAD
}

run_fixture_sync() {
    run env HOST_SHELL=local HOST_ROOT="$HOST_ROOT" \
        "$FIXTURE_REPO/scripts/golems-sync.sh" local "$@"
    return 0
}

make_tracked_worktree_skills() {
    TRACKED_SKILLS_ROOT="$BATS_TEST_TMPDIR/tracked-worktree"
    mkdir -p "$TRACKED_SKILLS_ROOT"
    git init --quiet "$TRACKED_SKILLS_ROOT"
    git -C "$REPO_ROOT" archive --format=tar HEAD -- skills/golem-powers \
        | tar -xf - -C "$TRACKED_SKILLS_ROOT"
    worktree_patch="$BATS_TEST_TMPDIR/tracked-worktree.patch"
    git -C "$REPO_ROOT" diff --binary HEAD -- skills/golem-powers > "$worktree_patch"
    if [[ -s "$worktree_patch" ]]; then
        git -C "$TRACKED_SKILLS_ROOT" apply "$worktree_patch"
    fi
}

@test "dry-run prints the plan and does not touch the host root" {
    run_sync --dry-run --only skills

    [ "$status" -eq 0 ]
    [[ "$output" == *"DRY RUN"* ]]
    [[ "$output" == *"added=2 updated=0 unchanged=0 backed-up=0"* ]]
    [ ! -e "$HOST_ROOT/.golems" ]
    [ ! -e "$HOST_ROOT/.claude" ]
}

@test "host argument rejects shell metacharacters before transport" {
    run "$SYNC_SCRIPT" 'm1;touch-pwned' --allow-dirty --dry-run

    [ "$status" -ne 0 ]
    [[ "$output" == *"unsafe host"* ]] || return 1
}

@test "feature branch is refused without the explicit source override" {
    fixture="$BATS_TEST_TMPDIR/feature-checkout"
    mkdir -p "$fixture/scripts/repogolem"
    cp "$SYNC_SCRIPT" "$fixture/scripts/golems-sync.sh"
    cp "$REPO_ROOT/scripts/repogolem/golems-sync-install.sh" \
        "$fixture/scripts/repogolem/golems-sync-install.sh"
    chmod +x "$fixture/scripts/golems-sync.sh" \
        "$fixture/scripts/repogolem/golems-sync-install.sh"
    git init --quiet --initial-branch=master "$fixture"
    git -C "$fixture" config user.email test@example.com
    git -C "$fixture" config user.name Test
    git -C "$fixture" add scripts
    git -C "$fixture" commit --quiet -m fixture
    git -C "$fixture" checkout --quiet -b feature/test

    run env \
        HOST_SHELL=local \
        HOST_ROOT="$HOST_ROOT" \
        GOLEMS_SYNC_SKILLS_SOURCE="$SKILLS_SOURCE" \
        "$fixture/scripts/golems-sync.sh" local --dry-run --only skills

    [ "$status" -ne 0 ]
    [[ "$output" == *"expected master"* ]] || return 1
    [ ! -e "$HOST_ROOT/.golems" ]
}

@test "machine-coupling guard refuses a developer-home path in shipped Markdown" {
    mkdir -p "$SKILLS_SOURCE/unsafe"
    # The literal developer path is the test input.
    # shellcheck disable=SC2016
    printf 'Run `/Users/testuser/.local/bin/codex`.\n' \
        > "$SKILLS_SOURCE/unsafe/SKILL.md"

    run_sync --dry-run --only skills

    [ "$status" -ne 0 ]
    [[ "$output" == *"machine-coupled payload refused"* ]]
    [[ "$output" == *"1 occurrence(s) across 1 file(s)"* ]]
    [[ "$output" == *"unsafe/SKILL.md:1"* ]]
    [[ "$output" == *"/Users/testuser/.local/bin/codex"* ]]
    [ ! -e "$HOST_ROOT/.golems" ]
}

@test "machine-coupling guard refuses a payload symlink that escapes the skill root" {
    outside="$BATS_TEST_TMPDIR/outside.py"
    printf 'print("outside")\n' > "$outside"
    mkdir -p "$SKILLS_SOURCE/unsafe/scripts"
    ln -s "$outside" "$SKILLS_SOURCE/unsafe/scripts/escape.py"

    run_sync --dry-run --only skills

    [ "$status" -ne 0 ]
    [[ "$output" == *"symlink escapes skills root"* ]] || return 1
    [[ "$output" == *"unsafe/scripts/escape.py"* ]] || return 1
    [ ! -e "$HOST_ROOT/.golems" ]
}

@test "working-tree allowlist cannot authorize the archived commit payload" {
    make_fixture_repo
    # shellcheck disable=SC2016
    printf 'Run `/Users/testuser/.local/bin/codex`.\n' \
        > "$FIXTURE_REPO/skills/golem-powers/alpha/SKILL.md"
    git -C "$FIXTURE_REPO" add skills/golem-powers/alpha/SKILL.md
    git -C "$FIXTURE_REPO" commit --quiet -m 'add coupled payload'
    git -C "$FIXTURE_REPO" update-ref refs/remotes/origin/master HEAD
    printf 'alpha/SKILL.md\t/Users/testuser\tuncommitted bypass\n' \
        >> "$FIXTURE_REPO/scripts/golems-sync-coupling-allowlist.tsv"

    run_fixture_sync --allow-dirty --dry-run --only skills

    [ "$status" -ne 0 ]
    [[ "$output" == *"machine-coupled payload refused"* ]]
    [[ "$output" == *"alpha/SKILL.md:1"* ]]
    [ ! -e "$HOST_ROOT/.golems" ]
}

@test "tracked runtime skill payload passes the coupling guard" {
    make_tracked_worktree_skills
    run env \
        HOST_SHELL=local \
        HOST_ROOT="$HOST_ROOT" \
        GOLEMS_SYNC_SKILLS_SOURCE="$TRACKED_SKILLS_ROOT/skills/golem-powers" \
        "$SYNC_SCRIPT" local --allow-dirty --dry-run --only skills

    [ "$status" -eq 0 ]
    [[ "$output" == *"DRY RUN"* ]]
    [[ "$output" != *"machine-coupled payload refused"* ]]
}

@test "copied skill is backed up once and replaced by the owned symlink" {
    make_fixture_repo
    mkdir -p "$HOST_ROOT/.claude/skills/alpha"
    mkdir -p "$HOST_ROOT/.claude/skills/unowned"
    mkdir -p "$HOST_ROOT/.golems/skills/golem-powers/obsolete"
    printf 'legacy\n' > "$HOST_ROOT/.claude/skills/alpha/legacy.txt"
    printf 'keep\n' > "$HOST_ROOT/.claude/skills/unowned/keep.txt"

    run_fixture_sync --only skills

    [ "$status" -eq 0 ]
    [ -L "$HOST_ROOT/.claude/skills/alpha" ]
    [ "$(readlink "$HOST_ROOT/.claude/skills/alpha")" = \
        "$HOST_ROOT/.golems/skills/golem-powers/alpha" ]
    [ -f "$HOST_ROOT/.golems/skills/golem-powers/alpha/SKILL.md" ]
    [ ! -e "$HOST_ROOT/.golems/skills/golem-powers/obsolete" ]
    [ -f "$HOST_ROOT/.claude/skills/unowned/keep.txt" ]

    backup_file="$(find "$HOST_ROOT/.golems" -path '*/skills.backup-*/alpha/legacy.txt' -print)"
    [ -n "$backup_file" ]
    [[ "$output" == *"backed-up=1"* ]]
}

@test "symlinked owned mirror root is refused without touching its target" {
    make_fixture_repo
    outside="$BATS_TEST_TMPDIR/outside-mirror"
    mkdir -p "$HOST_ROOT/.golems/skills" "$outside"
    printf 'keep\n' > "$outside/sentinel"
    ln -s "$outside" "$HOST_ROOT/.golems/skills/golem-powers"

    run_fixture_sync --only skills

    [ "$status" -ne 0 ]
    [[ "$output" == *"symlinked skills mirror component"* ]]
    [ -f "$outside/sentinel" ]
    [ ! -e "$outside/alpha" ]
}

@test "missing payload is added even when its owned skill link is already correct" {
    make_fixture_repo
    mkdir -p "$HOST_ROOT/.claude/skills"
    ln -s "$HOST_ROOT/.golems/skills/golem-powers/alpha" \
        "$HOST_ROOT/.claude/skills/alpha"

    run_fixture_sync --dry-run --only skills

    [ "$status" -eq 0 ]
    [[ "$output" == *"added=2 updated=0 unchanged=0 backed-up=0"* ]]
}

@test "second skills run is entirely unchanged" {
    make_fixture_repo
    printf 'do-not-ship\n' > "$FIXTURE_REPO/skills/golem-powers/alpha/secret.json"
    git -C "$FIXTURE_REPO" check-ignore --quiet skills/golem-powers/alpha/secret.json

    run_fixture_sync --only skills
    [ "$status" -eq 0 ]
    [ ! -e "$HOST_ROOT/.golems/skills/golem-powers/alpha/secret.json" ]
    first_payload_hash="$(jq -r '.payload_sha256' "$HOST_ROOT/.golems/INSTALLED.json")"

    run_fixture_sync --only skills

    [ "$status" -eq 0 ]
    [[ "$output" == *"added=0 updated=0 unchanged=2 backed-up=0"* ]]
    [ "$(find "$HOST_ROOT/.golems" -maxdepth 1 -type d -name 'skills.backup-*' | wc -l | tr -d ' ')" -eq 0 ]
    [ "$(jq -r '.counts.unchanged' "$HOST_ROOT/.golems/INSTALLED.json")" -eq 2 ]
    [ "$(jq -r '.commit' "$HOST_ROOT/.golems/INSTALLED.json")" = "$(git -C "$FIXTURE_REPO" rev-parse HEAD)" ]
    [ "$(jq -r '.dirty' "$HOST_ROOT/.golems/INSTALLED.json")" = false ]
    [[ "$(jq -r '.payload_sha256' "$HOST_ROOT/.golems/INSTALLED.json")" =~ ^[a-f0-9]{64}$ ]]
    [ -n "$(jq -r '.ts' "$HOST_ROOT/.golems/INSTALLED.json")" ]
    [ -n "$(jq -r '.source_host' "$HOST_ROOT/.golems/INSTALLED.json")" ]

    printf 'dirty but not shipped\n' > "$FIXTURE_REPO/dirty-marker"
    run_fixture_sync --only skills --allow-dirty

    [ "$status" -eq 0 ]
    [[ "$output" == *"added=0 updated=0 unchanged=2 backed-up=0"* ]]
    [ "$(jq -r '.dirty' "$HOST_ROOT/.golems/INSTALLED.json")" = true ]
    [ "$(jq -r '.payload_sha256' "$HOST_ROOT/.golems/INSTALLED.json")" = "$first_payload_hash" ]
    [ ! -e "$HOST_ROOT/.golems/skills/golem-powers/alpha/secret.json" ]
    [ ! -e "$HOST_ROOT/.golems/skills/golem-powers/dirty-marker" ]
}

@test "launcher installer produces a byte-identical dispatcher" {
    run_sync --only launcher

    [ "$status" -eq 0 ]
    [ -x "$HOST_ROOT/.config/ralphtools/golem-dispatch.zsh" ]
    cmp -s \
        "$REPO_ROOT/scripts/repogolem/golem-dispatch.zsh" \
        "$HOST_ROOT/.config/ralphtools/golem-dispatch.zsh"
    [[ "$output" == *"launcher hash verified"* ]]
    [ "$(jq -r '.counts.added' "$HOST_ROOT/.golems/INSTALLED.json")" -eq 1 ]
}

@test "unchanged launcher is verified without rewriting it" {
    run_sync --only launcher
    [ "$status" -eq 0 ]
    dispatcher="$HOST_ROOT/.config/ralphtools/golem-dispatch.zsh"
    first_mtime="$(portable_stat mtime "$dispatcher")"
    sleep 1

    run_sync --only launcher

    [ "$status" -eq 0 ]
    [[ "$output" == *"added=0 updated=0 unchanged=1 backed-up=0"* ]]
    [ "$(portable_stat mtime "$dispatcher")" = "$first_mtime" ]
}
