"""Definitions moved byte-faithfully from the executable hook."""
import re
import os
_POSITIONAL_PARAM_RE = re.compile(r"\$(?:[1-9][0-9]*|[@*])")


def _nearest_repo_root(start):
    """Walk up from `start` to the nearest directory holding a `.git` entry
    (a file in a linked worktree, a directory in the main checkout)."""
    cur = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent


def _literal_prefix_scan(word, variables=None, variable_prefixes=None):
    """Return (literal_prefix, found_dynamic) for one shell word.

    Walks left to right expanding only constructs whose value the hook can
    know for certain, and stops at the first one it cannot. `found_dynamic`
    distinguishes "the whole word is literal" (no proof needed — the caller
    resolves it outright) from "a literal head, then something unreadable".

    `variable_prefixes` supplies the literal head of a variable whose own
    value is only partially static (`P=~/Documents/x_$$.txt`), so a target
    routed through a variable proves exactly what the same path spelled
    inline proves. Every value that variable can hold starts with that head.
    """
    prefix = []
    i = 0
    found_dynamic = False
    while i < len(word):
        if word[i] != "$":
            if word[i] in "`*?{[":
                found_dynamic = True
                break
            prefix.append(word[i])
            i += 1
            continue
        if word.startswith("$(", i):
            found_dynamic = True
            break
        match = _SIMPLE_VAR_RE.match(word, i)
        if match:
            name = match.group(1) or match.group(2)
            if variables is not None and name in variables:
                value = variables[name]
            else:
                value = os.environ.get(name)
            if value:
                prefix.append(value)
                i = match.end()
                continue
            if value is None and variable_prefixes:
                # Unknown value, known head. An explicitly-unset variable
                # (value == "") is knowably empty and contributes nothing.
                partial = variable_prefixes.get(name)
                if partial:
                    prefix.append(partial)
            found_dynamic = True
            break
        if word.startswith("${", i) or _POSITIONAL_PARAM_RE.match(word, i):
            found_dynamic = True
            break
        found_dynamic = True
        break
    return "".join(prefix), found_dynamic


def _has_literal_parent_component(text):
    """Return whether shell text contains a literal `..` path component."""
    return ".." in [part for part in text.split(os.sep) if part]


def _literal_prefix_class(
    raw, anchor, *, require_worktree=False, variables=None,
    variable_prefixes=None, tokens=None, scope_of=None, target_index=None,
):
    """Return `repo`/`temp`/`outside` when a literal prefix proves a class.

    golems#676 says never block blind. The 2026-08-12 cmuxlayer loop proved
    Rule 2's `.worktrees/$wt` prefix, and the 2026-08-13 live Rule 1 specimen
    (`$D/logs/post-rerun-$(date +%s).log`) proves the same fact for a durable
    repo redirect. A dynamic suffix could theoretically contain `..`; the
    accepted residual remains for suffixes without visible traversal. Literal
    `..` is disqualifying in both the outer word and command-substitution
    bodies, and Rule 1 additionally rejects prefixes in the temp class.
    """
    s = raw.strip()
    if _QUOTED_LBRACE in s or _QUOTED_RBRACE in s:
        return None
    word_text = s
    if tokens is not None and scope_of is not None and target_index is not None:
        word_text = _substitution_word_text(tokens, scope_of, target_index)
    if _has_literal_parent_component(s) or any(
        _has_literal_parent_component(body)
        for body, _outer_seg, _sub_index, _exposed
        in _executable_subcommands(word_text)
    ):
        return None

    # Resolve known simple variables. Stop at the first construct whose value
    # the hook cannot know; every shell-dynamic form follows this one path.
    prefix, found_dynamic = _literal_prefix_scan(
        s, variables, variable_prefixes
    )
    if not found_dynamic or not prefix:
        return None

    # The sentinel represents the first unresolvable construct, preserving
    # `.worktrees` as a non-terminal component after lexical normalization.
    probe = os.path.expanduser(prefix + "__tmp_block_dynamic_suffix__")
    if os.path.isabs(probe):
        probe = os.path.normpath(probe)
        repo = _nearest_repo_root(probe)
    else:
        repo = _nearest_repo_root(anchor) if anchor else None
        if repo is None:
            return None
        probe = os.path.normpath(os.path.join(anchor, probe))
    # `scratchpad` is its own verdict, decided before any of the temp/repo/
    # outside reasoning below. Keeping it independent is deliberate: the
    # `outside` proof and the head-proving machinery are under review
    # (2026-08-17 lead note, the `<repo>$(printf /../../tmp/x)` ask->allow
    # question), and the harness-scratchpad allowlist must not move with
    # whichever way that lands.
    # Only Rule 1 consumes it; worktree-convention callers still require repo
    # membership and get None, exactly as they do for `outside`.
    # GO-5: a dynamic suffix glued onto the last component (`/tmp$X`) can also
    # start a new component (`X=/y` -> `/tmp/y`). Judge both readings; if they
    # land in different temp classes, the head proves nothing (unresolvable).
    glued = os.path.basename(probe)
    if glued != "__tmp_block_dynamic_suffix__" and glued.endswith("__tmp_block_dynamic_suffix__"):
        head = glued[: -len("__tmp_block_dynamic_suffix__")]
        segment_probe = os.path.join(os.path.dirname(probe), head, "__tmp_block_dynamic_suffix__")
        if in_temp_class(segment_probe) != in_temp_class(probe):
            return None
    if is_harness_scratchpad(probe):
        return None if require_worktree else "scratchpad"
    if in_temp_class(probe):
        return "temp"
    if repo is None:
        # An absolute prefix that is provably NOT temp answers Rule 1 in full,
        # even when it belongs to no repository. Returning None here was the
        # 2026-08-14 live defect: `P=~/Documents/blprobe_$$.txt; ... > "$P"`
        # prompted on every run because `~/Documents` is neither temp nor a
        # repo, so a guard that can only prove two classes had to ask about
        # the entire home directory. `outside` is the third proof, and only
        # Rule 1 consumes it — worktree-convention callers still require repo
        # membership and get None as before.
        return None if require_worktree else "outside"
    if require_worktree:
        if not on_convention(probe):
            return None
    real_repo = os.path.normpath(os.path.realpath(repo))
    real_probe = os.path.normpath(os.path.realpath(probe))
    try:
        return "repo" if (
            os.path.commonpath((repo, probe)) == repo
            and os.path.commonpath((real_repo, real_probe)) == real_repo
        ) else None
    except ValueError:
        return None


def suggest_fixed_target(resolved, anchor=None):
    """The exact path the ratified convention wants for this add."""
    name = os.path.basename(resolved.rstrip(os.sep)) or "worktree"
    parent = os.path.dirname(resolved.rstrip(os.sep))
    base = os.path.basename(parent)
    # The observed drift shape names its own repo: `<repo>.wt/<name>`.
    if base.endswith(".wt"):
        candidate = os.path.join(os.path.dirname(parent), base[: -len(".wt")])
        if os.path.exists(os.path.join(candidate, ".git")):
            return candidate, os.path.join(candidate, WORKTREE_DIR_NAME, name)
    repo = _nearest_repo_root(anchor or os.getcwd())
    if repo:
        return repo, os.path.join(repo, WORKTREE_DIR_NAME, name)
    return "<repo>", f"<repo>/{WORKTREE_DIR_NAME}/{name}"
