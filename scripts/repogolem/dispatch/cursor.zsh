# Cursor CLI dispatch is retired. Keep stale launcher names fail-closed.
_golem_launch_cursor() {
  print -u2 -- 'Cursor CLI dispatch is retired. Use T3 delegate_task with target: {providerInstanceId: "cursor", model: "default"}.'
  return 1
}
