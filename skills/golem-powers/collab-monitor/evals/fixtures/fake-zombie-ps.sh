#!/bin/sh
if [ -n "${COLLAB_MONITOR_FAKE_ZOMBIE_PID:-}" ] && [ "${2:-}" = "$COLLAB_MONITOR_FAKE_ZOMBIE_PID" ] && [ "${4:-}" = 'stat=' ]; then
  printf '%s\n' 'Z'
  exit 0
fi
exec /bin/ps "$@"
