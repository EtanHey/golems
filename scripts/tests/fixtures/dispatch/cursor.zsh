# Cursor CLI dispatch is retired. Keep stale launcher names fail-closed.
_golem_launch_cursor() {
  print -u2 -- 'Cursor is retired; see /agent-routing for supported Codex or Claude roles.'
  return 1
}
