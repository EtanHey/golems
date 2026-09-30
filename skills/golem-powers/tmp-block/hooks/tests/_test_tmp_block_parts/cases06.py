from .common import *  # noqa: F403

def test_scratchpad_write_and_edit_are_allowed():
    """Rule 1's file-tool surface honours the exception too, not just redirects."""
    path = f"{SCRATCHPAD_DIR}/notes.md"
    assert_allowed(run_hook(write_payload(path)))
    assert_allowed(
        run_hook(
            {
                "tool_name": "Edit",
                "tool_input": {
                    "file_path": path,
                    "old_string": "a",
                    "new_string": "b",
                },
                "session_id": "tmp-block-test",
            }
        )
    )


def test_scratchpad_every_write_surface_is_allowed(durable_path):
    """The exception is not redirect-only: appends, tee and heredocs too."""
    target = f"{SCRATCHPAD_DIR}/surface.txt"
    for command in (
        f"printf x > {target}",
        f"printf x >> {target}",
        f"printf x | tee {target}",
        f"printf x | tee -a {target}",
        f"cat > {target} <<'EOF'\nbody\nEOF",
        f"cat <<'EOF' > {target}\nbody\nEOF",
    ):
        assert_allowed(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_scratchpad_with_a_dynamic_filename_is_allowed(durable_path):
    """A dynamic leaf under a proven scratchpad prefix is still the scratchpad."""
    proc = run_hook(
        bash_payload(f'printf x > {SCRATCHPAD_DIR}/probe_$$.txt'),
        cwd=str(durable_path),
    )
    assert_allowed(proc)


def test_bare_scratchpad_directory_without_the_session_chain_is_denied(durable_path):
    """`/private/tmp/scratchpad` is not the harness's — it has no session chain."""
    assert_denied(run_hook(write_payload("/private/tmp/scratchpad/x.txt")))
    assert_denied(
        run_hook(
            bash_payload("printf x > /private/tmp/scratchpad/x.txt"),
            cwd=str(durable_path),
        )
    )


def test_claude_uid_dir_without_a_scratchpad_component_is_denied(durable_path):
    """The uid directory alone is temp; only the full chain is allowlisted."""
    assert_denied(run_hook(write_payload("/private/tmp/claude-501/x.txt")))
    assert_denied(
        run_hook(
            write_payload(
                f"/private/tmp/claude-501/-Users-example-Gits-golems/"
                f"{SCRATCHPAD_UUID}/x.txt"
            )
        )
    )
    assert_denied(
        run_hook(
            bash_payload("printf x > /private/tmp/claude-501/x.txt"),
            cwd=str(durable_path),
        )
    )


def test_scratchpad_shape_requires_a_session_uuid(durable_path):
    """Match the structure — a non-UUID component is not a session directory."""
    assert_denied(
        run_hook(
            write_payload(
                "/private/tmp/claude-501/-Users-example-Gits-golems/"
                "not-a-uuid/scratchpad/x.txt"
            )
        )
    )


def test_scratchpad_dotdot_escape_is_denied(durable_path):
    """`..` out of the scratchpad lands in the bare temp class and is judged there."""
    assert_denied(run_hook(write_payload(f"{SCRATCHPAD_DIR}/../../../../leak.txt")))
    assert_denied(
        run_hook(
            bash_payload(f"printf x > {SCRATCHPAD_DIR}/../../../../leak.txt"),
            cwd=str(durable_path),
        )
    )


def test_mktemp_still_denied_alongside_the_scratchpad_exception(durable_path):
    """`$(mktemp)` has no scratchpad chain — both forms stay refused."""
    for command in (
        'printf x > "$(mktemp)"',
        'T=$(mktemp); echo noise > "$T"',
        'T=$(mktemp -d); printf x > "$T/f.txt"',
    ):
        assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_plain_tmp_still_denied_alongside_the_scratchpad_exception(durable_path):
    """The rest of the temp class is untouched by the exception."""
    assert_denied(run_hook(write_payload("/tmp/foo.txt")))
    assert_denied(
        run_hook(bash_payload("printf x > /tmp/foo.txt"), cwd=str(durable_path))
    )


def test_scratchpad_component_must_be_exact_not_a_prefix_or_suffix(durable_path):
    """`scratchpad-evil` and `myscratchpad` are not the harness's scratchpad.

    Mutation guard (#727 review): relaxing the exact-component check to
    `"scratchpad" in pad` opened both of these as ALLOW while the whole suite
    stayed green. A deny-side test that no mutation can redden is decoration.
    """
    for evil in ("scratchpad-evil", "myscratchpad", "scratchpad.bak"):
        path = (
            f"/private/tmp/claude-501/-Users-example-Gits-golems/"
            f"{SCRATCHPAD_UUID}/{evil}/x.txt"
        )
        assert_denied(run_hook(write_payload(path)))
        assert_denied(
            run_hook(bash_payload(f"printf x > {path}"), cwd=str(durable_path))
        )


def test_uid_dir_must_be_claude_plus_digits(durable_path):
    """The uid component is `claude-<digits>` — not any directory at all.

    Mutation guard (#727 review): dropping the `_CLAUDE_UID_DIR_RE` check made
    every `/private/tmp/<anything>/<slug>/<uuid>/scratchpad/` an ALLOW with the
    suite still green. These cases redden that mutation.
    """
    for uid_dir in ("claude-abc", "claude-", "claude", "notclaude-501", "attacker"):
        path = (
            f"/private/tmp/{uid_dir}/-Users-example-Gits-golems/"
            f"{SCRATCHPAD_UUID}/scratchpad/x.txt"
        )
        assert_denied(run_hook(write_payload(path)))
        assert_denied(
            run_hook(bash_payload(f"printf x > {path}"), cwd=str(durable_path))
        )


def test_scratchpad_chain_must_sit_directly_under_a_temp_root(durable_path):
    """One extra component before `claude-<uid>` breaks the chain.

    Pins the "directly under a temp root" half of the shape: without it, an
    attacker-controlled subdirectory could carry a well-formed chain.
    """
    path = (
        f"/private/tmp/nested/claude-501/-Users-example-Gits-golems/"
        f"{SCRATCHPAD_UUID}/scratchpad/x.txt"
    )
    assert_denied(run_hook(write_payload(path)))
    assert_denied(
        run_hook(bash_payload(f"printf x > {path}"), cwd=str(durable_path))
    )


def test_quote_with_many_escapes_in_a_comment_is_linear():
    # CodeQL py/redos #3/#4: an unclosed `"` followed by many `\!` made the
    # raw-line tokenizer backtrack exponentially (7.8s at 24 pairs).
    start = time.perf_counter()
    proc = run_hook(bash_payload('echo hi # "' + "\\!" * 32))
    elapsed = time.perf_counter() - start
    assert_allowed(proc)
    assert elapsed < 3, f"hook took {elapsed:.1f}s on a pathological comment"


@pytest.mark.parametrize("word", sorted(TEMP_HINT_WORD_CASES))
def test_each_extra_temp_word_makes_an_unresolvable_target_a_refusal(word, durable_path, monkeypatch):
    monkeypatch.delenv("TMP", raising=False)
    monkeypatch.delenv("TEMP", raising=False)
    assert_refused(run_hook(bash_payload(TEMP_HINT_WORD_CASES[word]), cwd=str(durable_path)))


def test_temp_like_prose_words_are_not_hints(durable_path):
    for command in (
        'P=$(render template); printf x > "$P"',
        'P=$(echo temporary); printf x > "$P"',
        'P=$TEMPLATE_DIR/x; printf x > "$P"',
    ):
        assert_advised(run_hook(bash_payload(command), cwd=str(durable_path)))


# GO-5 (found on #226): a literal temp head with an unknown suffix glued on
# (`/tmp$UNSET`) was a clean ALLOW. The probe read it as `/tmpXYZ`, outside the
# class, but `UNSET=/x` makes it `/tmp/x`. Ambiguous heads prove nothing.
def test_a_temp_head_with_a_glued_unknown_suffix_is_not_proven_outside(durable_path, monkeypatch):
    monkeypatch.delenv("UNSET", raising=False)
    for command in (
        'D=/tmp; P=$D$UNSET; printf x > "$P"',
        'D=/tmp; printf x > "$D$UNSET"',
        'printf x > "/tmp$UNSET"',
        'printf x > "/tmp${UNSET}"',
    ):
        assert_refused(run_hook(bash_payload(command), cwd=str(durable_path)))


def test_glued_suffixes_that_stay_in_one_class_are_still_judged(durable_path, monkeypatch):
    monkeypatch.delenv("UNSET", raising=False)
    # Both readings are durable (repo) or both outside: the head still proves the class.
    assert_allowed(run_hook(bash_payload('printf x > "docs.local/post-$UNSET.log"'), cwd=str(durable_path)))
    assert_allowed(run_hook(bash_payload('P=~/Documents/x_$$.txt; printf x > "$P"'), cwd=str(durable_path)))
    assert_allowed(run_hook(bash_payload('printf x > "/tmpfoo/x"'), cwd=str(durable_path)))


