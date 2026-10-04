"""Definitions moved byte-faithfully from the executable hook."""


def _direct_exposed_scope_keys(command, scope_of):
    """Map top-level lexer scope IDs to recursive substitution identities."""
    scope_ids = []
    for scope in scope_of:
        if len(scope) == 1 and scope[0] not in scope_ids:
            scope_ids.append(scope[0])
    exposed = [
        (outer_seg, sub_index)
        for _body, outer_seg, sub_index, is_exposed in _executable_subcommands(
            _strip_heredoc_bodies(command)
        )
        if is_exposed
    ]
    return dict(zip(scope_ids, exposed))


def _after_substitution_word(tokens, scope_of, opener, parent_scope):
    """Return the first token after the shell word containing `opener`.

    Command substitutions are tokenized into child scopes, while any literal
    suffix returns to the parent scope. A `)$+` close marker records that the
    same shell word continues, so option values such as `--reason=$(x)suffix`
    can be skipped without mistaking `suffix` for the worktree path.
    """
    j = opener + 1
    while True:
        while j < len(tokens) and scope_of[j] != parent_scope:
            j += 1
        if (
            j == 0
            or not _command_sub_word_continues(tokens[j - 1])
            or j >= len(tokens)
        ):
            return j
        if tokens[j] in (";", "|", "&", ">", ">>", "(", ")"):
            return j
        suffix = tokens[j]
        j += 1
        if not _is_command_sub_open(suffix):
            return j


def _substitution_word_text(tokens, scope_of, opener):
    """Rebuild the token span for one shell word containing `$(...)`."""
    if not _is_command_sub_open(tokens[opener]):
        return tokens[opener]
    end = _after_substitution_word(
        tokens, scope_of, opener, scope_of[opener]
    )
    return " ".join(tokens[opener:end])
