"""Public metadata-filter mechanics use benign domains and print-only input."""
import pytest
from test_repo_parent_rm import guardian

parametrize = pytest.mark.parametrize


@parametrize('pattern, expected', [('item-??', True), ('item-a?', True),
    ('item-z?', False), ('item-[ab]?', True), ('other-*', False)])
def test_bounded_filename_domain_overlap(pattern, expected):
    assert guardian._rm._glob_matches_domains(pattern, list('item-') + ['ab', '12']) is expected


@parametrize('mode, follows', [('P', False), ('H', True), ('L', True)])
def test_follow_mode_preserves_default_parser_contract(mode, follows):
    args = ['-' + mode, 'fixture', '-print']
    original = guardian._rm._find_deletion_roots(args)
    extended = guardian._rm._find_deletion_roots(args, include_follow_mode=True)
    assert len(original) == 5
    assert extended[:5] == original
    assert original[1] is follows
    assert extended[-1] == mode


def test_name_operand_cannot_change_find_follow_mode():
    parsed = guardian._rm._find_deletion_roots(['fixture', '-name', '-L', '-print'], include_follow_mode=True)
    assert parsed[-1] == 'P'


@parametrize('word', ['-mindepth', '-maxdepth'])
def test_nested_print_action_does_not_change_outer_depth(word):
    args = ['fixture', '-exec', 'printf', word, '99', ';', '-print']
    parsed = guardian._rm._find_deletion_roots(args, include_depth_limits=True)
    assert parsed[-1] == (0, None)


@parametrize('word, expected', [('-mindepth', (2, None)), ('-maxdepth', (0, 2))])
def test_outer_depth_retains_print_only_parser_contract(word, expected):
    args = ['fixture', word, '2', '-print']
    original = guardian._rm._find_deletion_roots(args)
    extended = guardian._rm._find_deletion_roots(args, include_depth_limits=True)
    assert len(original) == 5 and extended[:5] == original
    assert extended[-1] == expected


@parametrize('setting', ['_METADATA_PROBE_LIMIT', '_METADATA_PROBE_SECONDS'])
def test_over_budget_cleanup_gives_bounded_target_guidance(tmp_path, monkeypatch, setting):
    (tmp_path / 'ordinary' / 'child').mkdir(parents=True)
    monkeypatch.setattr(guardian._rm, setting, -1)
    api = {'_expand_known_vars': lambda value, variables: (value, True)}
    reason = guardian._rm._metadata_traversal_reason(
        api, str(tmp_path), str(tmp_path), {},
        [([('-name', 'benign-marker')], False)], 'P', (0, None))
    assert 'cleanup target is too large to verify within budget' in reason
    assert '-maxdepth' in reason and 'narrower root' in reason
    assert 'unavailable' not in reason and 'reinstall' not in reason
