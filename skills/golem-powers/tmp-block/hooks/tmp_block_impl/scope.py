"""Definitions moved byte-faithfully from the executable hook."""
import re


def _paren_contexts(tokens):
    """Opening-parenthesis stack enclosing each token.

    This is deliberately narrower than full shell scope modelling. It gives
    the stale-value guard enough structure to distinguish a mutation inside a
    subshell/process substitution from a later command back in the parent.
    """
    contexts = []
    stack = []
    for token in tokens:
        contexts.append(tuple(stack))
        if token == "(":
            stack.append(len(contexts) - 1)
        elif token == ")" and stack:
            stack.pop()
    return contexts


def _segment_indices(seg_of, segment):
    """Token indices belonging to one parsed simple-command segment."""
    return [i for i, seg in enumerate(seg_of) if seg == segment]


def _process_substitution_parens(tokens):
    """Parenthesis indices belonging to `<(...)` / `>(...)`, not subshells."""
    indices = set()
    stack = []
    for i, token in enumerate(tokens):
        if token == "(":
            stack.append((i, i > 0 and tokens[i - 1] in ("<", ">")))
        elif token == ")" and stack:
            opened, process_substitution = stack.pop()
            if process_substitution:
                indices.update((opened, i))
    return indices


def _case_pattern_parens(tokens):
    """Parentheses that terminate literal case patterns, not subshells."""
    indices = set()
    stack = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token == "case":
            stack.append("await-in")
        elif stack and stack[-1] == "await-in" and token == "in":
            stack[-1] = "pattern"
        elif stack and stack[-1] == "pattern" and token == ")":
            indices.add(index)
            stack[-1] = "body"
        elif stack and stack[-1] == "body":
            if tokens[index:index + 2] == [";", ";"]:
                stack[-1] = "pattern"
                index += 1
            elif token == "esac":
                stack.pop()
        index += 1
    return indices


def _literal_array_parens(tokens):
    """Parentheses delimiting a literal shell array assignment."""
    indices = set()
    for opener in range(1, len(tokens)):
        if tokens[opener] != "(" or not re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*=", tokens[opener - 1]
        ):
            continue
        depth = 1
        for closer in range(opener + 1, len(tokens)):
            if tokens[closer] == "(":
                depth += 1
            elif tokens[closer] == ")":
                depth -= 1
                if depth == 0:
                    indices.update((opener, closer))
                    break
    return indices


def _success_chain_reaches(tokens, seg_of, segment, target_segment):
    """True when every command boundary through the target is `&&`.

    A cwd change after `&&` is a valid anchor when the eventual worktree add
    is gated by the same success chain: the add cannot run unless the cd did.
    A `;`, pipeline, or background boundary breaks that guarantee.
    """
    current = _segment_indices(seg_of, segment)
    target = _segment_indices(seg_of, target_segment)
    if not current or not target:
        return False
    current_words = [i for i in current if not _is_separator(tokens, i)]
    target_words = [i for i in target if not _is_separator(tokens, i)]
    if not current_words or not target_words:
        return False
    i = current_words[-1] + 1
    while i < target_words[0]:
        if tokens[i:i + 2] == ["&", "&"]:
            i += 2
            continue
        if _is_separator(tokens, i):
            return False
        i += 1
    return True


def _scope_affects_target(command_scope, target_scope):
    """A parent or matching substitution scope can affect the target cwd."""
    return (
        len(command_scope) <= len(target_scope)
        and target_scope[:len(command_scope)] == command_scope
    )
