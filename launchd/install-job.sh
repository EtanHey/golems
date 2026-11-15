#!/bin/bash
# Explicit opt-in installer for adopted jobs and fleet templates; no batch activation.
set -euo pipefail
script_dir=$(cd "$(dirname "$0")" && pwd -P)
label=${1:?usage: install-job.sh com.golems.LABEL [--skip-launchctl]}
case "$label" in
  com.golems.stream-watcher|com.golems.stalker-live-guard|com.golems.comfyui|com.golems.worktree-gc) source_plist="$script_dir/$label.plist" ;;
  com.golems.ratchet-inbox-relay) source_plist="$script_dir/../scripts/fleet/$label.plist.template" ;;
  *) echo 'Use the dedicated installer for this job' >&2; exit 2 ;;
esac
[[ $# == 1 || ( $# == 2 && $2 == --skip-launchctl ) ]] || exit 2
installed="$HOME/Library/LaunchAgents/$label.plist"
candidate="$installed.candidate"
"$script_dir/render-plist.sh" "$source_plist" "$candidate"
"${NODE_BIN:-$(command -v node)}" "$script_dir/named-program.mjs" "$candidate"
plutil -lint "$candidate"
mv "$candidate" "$installed"
if [[ ${2:-} != --skip-launchctl ]]; then
  domain="gui/$(id -u)"
  if launchctl print "$domain/$label" >/dev/null 2>&1; then launchctl bootout "$domain/$label"; fi
  launchctl bootstrap "$domain" "$installed"
  launchctl print "$domain/$label"
fi
