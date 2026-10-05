"""Definitions moved byte-faithfully from the executable hook."""


# git worktree add flags that consume a value.
_WORKTREE_VALUE_FLAGS = {"-b", "-B", "--reason"}


# ── Rule 2: worktree location convention ─────────────────────────────────────


def _worktree_add_args(tokens, cmd_pos, seg_of, scope_of):
    """Return [(raw_path_token, segment, scope, index)] for each creation."""
    found = []
    for idx in range(len(tokens) - 1):
        if tokens[idx] == "worktree" and tokens[idx + 1] == "add":
            # Require a git invocation earlier in the same statement segment —
            # match by basename so `/usr/bin/git worktree add` is covered too
            # (Bugbot f8d22aeb).
            seg_start = idx
            while seg_start > 0 and not _is_separator(tokens, seg_start - 1):
                seg_start -= 1
            if not any(
                (tok == "git" or tok.endswith("/git"))
                and cmd_pos[j]
                and scope_of[j] == scope_of[idx]
                for j, tok in enumerate(tokens[seg_start:idx], start=seg_start)
            ):
                continue
            skip_next = False
            j = idx + 2
            while j < len(tokens):
                arg = tokens[j]
                if scope_of[j] != scope_of[idx]:
                    break
                if skip_next:
                    skip_next = False
                    if _is_command_sub_open(arg):
                        j = _after_substitution_word(
                            tokens, scope_of, j, scope_of[idx]
                        )
                        continue
                    j += 1
                    continue
                if arg in (";", "|", "&", ">", ">>"):
                    break
                if arg in _WORKTREE_VALUE_FLAGS:
                    skip_next = True
                    j += 1
                    continue
                if arg.startswith("-"):
                    j += 1
                    if _is_command_sub_open(arg):
                        # `--reason=$(...)` carries its value in a child
                        # substitution scope. Skip that scope, then resume in
                        # the parent to find the actual worktree path.
                        j = _after_substitution_word(
                            tokens, scope_of, j - 1, scope_of[idx]
                        )
                    continue
                found.append((arg, seg_of[idx], scope_of[idx], j))
                break  # first non-flag arg is the worktree path
    return found
