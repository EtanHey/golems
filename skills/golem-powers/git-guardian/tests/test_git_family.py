"""Git's per-subcommand executables are judged as git.

Class-level only: the subcommand below is made up, so no case here is a
working command. Live regressions stay in the private guard suite."""
from _test_git_safety_parts.common import git_safety


def test_family_maps_to_git_and_its_subcommand_in_any_case():
    assert git_safety.git_family("git") == ""
    assert git_safety.git_family("/usr/bin/GIT") == ""
    assert git_safety.git_family("git-frobnicate") == "frobnicate"
    assert git_safety.git_family("/opt/x/libexec/GIT-FROBNICATE") == "frobnicate"


def test_other_words_are_not_git():
    for word in ("gitk", "github", "legit", "git-", "ls", "/usr/bin/gitx"):
        assert git_safety.git_family(word) is None, word


def test_token_scan_only_counts_known_subcommands():
    # split_git scans every token; a made-up family word must not be read as git.
    assert git_safety.split_git("echo git-frobnicate --force") is None
