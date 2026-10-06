"""Deadline and repository-shape mechanics use read-only synthetic fixtures."""
from test_repo_parent_rm import guardian


def test_inner_entry_deadline_refuses_before_any_selected_child(tmp_path, monkeypatch):
    # The root-pop deadline is still live; only the entry-loop deadline expires.
    (tmp_path / 'ordinary-file').write_text('ordinary data')
    clock = iter([0.0, 0.0, 3.0])
    monkeypatch.setattr(guardian._rm.time, 'monotonic', lambda: next(clock))
    api = {'_expand_known_vars': lambda value, variables: (value, True)}
    reason = guardian._rm._metadata_traversal_reason(
        api, str(tmp_path), str(tmp_path), {},
        [([('-name', 'benign-marker')], False)], 'P', (0, None))
    assert reason == guardian._rm._METADATA_PROBE_REASON
    assert '-maxdepth' in reason and 'narrower root' in reason


def make_bare_shape(path):
    (path / 'objects').mkdir(parents=True)
    (path / 'refs' / 'heads').mkdir(parents=True)
    (path / 'HEAD').write_text('ref: refs/heads/topic\n')
    (path / 'refs' / 'heads' / 'benign-marker').write_text('0' * 40 + '\n')
    return path


def test_bare_root_and_container_recognition(tmp_path):
    bare = make_bare_shape(tmp_path / 'container' / 'archive')
    assert guardian._outermost_repo_root(str(bare)) == str(bare)
    assert guardian._outermost_repo_root(str(bare / 'refs' / 'heads')) == str(bare)
    assert guardian._paths._probe_repo_children(str(bare.parent))


def test_bare_metadata_is_seen_from_container_and_root(tmp_path):
    bare = make_bare_shape(tmp_path / 'container' / 'archive')
    api = {'_expand_known_vars': lambda value, variables: (value, True)}
    for root in [bare.parent, bare, bare / 'refs']:
        reason = guardian._rm._metadata_traversal_reason(
            api, str(root), str(tmp_path), {},
            [([('-name', 'benign-marker')], False)], 'P', (0, None))
        assert reason == 'find deletion selects repository metadata'


def test_partial_bare_shape_does_not_protect_ordinary_tree(tmp_path):
    ordinary = tmp_path / 'ordinary'
    (ordinary / 'objects').mkdir(parents=True)
    (ordinary / 'HEAD').write_text('ordinary notes')
    assert guardian._outermost_repo_root(str(ordinary)) is None
    assert not guardian._paths._probe_repo_children(str(ordinary))


def test_followed_cycle_has_its_own_refusal(tmp_path, monkeypatch):
    (tmp_path / 'loop').symlink_to(tmp_path, target_is_directory=True)
    monkeypatch.setattr(guardian._rm.time, 'monotonic', lambda: 0.0)
    api = {'_expand_known_vars': lambda value, variables: (value, True)}
    reason = guardian._rm._metadata_traversal_reason(
        api, str(tmp_path), str(tmp_path), {},
        [([('-name', 'benign-marker')], False)], 'L', (0, None))
    assert reason == 'find metadata traversal cannot be evaluated safely'


def test_depth_cap_refuses_without_time_or_entry_cap(tmp_path, monkeypatch):
    current = tmp_path
    for _ in range(65):
        current = current / 'child'
        current.mkdir()
    monkeypatch.setattr(guardian._rm.time, 'monotonic', lambda: 0.0)
    monkeypatch.setattr(guardian._rm, '_METADATA_PROBE_LIMIT', 1_000_000)
    api = {'_expand_known_vars': lambda value, variables: (value, True)}
    assert guardian._rm._metadata_traversal_reason(
        api, str(tmp_path), str(tmp_path), {},
        [([('-name', 'benign-marker')], False)], 'P', (0, None)) == guardian._rm._METADATA_PROBE_REASON


def test_outer_depth_bounds_remain_effective(tmp_path):
    bare = make_bare_shape(tmp_path / 'archive')
    api = {'_expand_known_vars': lambda value, variables: (value, True)}
    call = lambda filters, limits: guardian._rm._metadata_traversal_reason(
        api, str(bare), str(tmp_path), {}, [(filters, False)], 'P', limits)
    assert call([('-name', 'benign-marker')], (0, 2)) is None
    assert call([('-name', 'benign-marker')], (0, 3))
    assert call([('-name', 'archive')], (1, None)) is None
    assert call([('-name', 'archive')], (0, None))
