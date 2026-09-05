#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
golems_root=${GOLEMS_ROOT:-$(cd "$script_dir/.." && pwd -P)}
task_home=${HOME:?HOME must be set}
label=com.golems.stalker-morning-digest
source_plist="$script_dir/$label.plist"
installed_plist="$task_home/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

mkdir -p "$task_home/Library/LaunchAgents" "$golems_root/docs.local/stalker-golem"

uninstall=0
skip_launchctl=0
for argument in "$@"; do
  case "$argument" in
    --uninstall) uninstall=1 ;;
    --skip-launchctl) skip_launchctl=1 ;;
    *) printf 'unknown argument: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

if [[ $uninstall == 1 ]]; then
  if [[ $skip_launchctl == 0 ]]; then
    launchctl bootout "$domain/$label" 2>/dev/null || true
  fi
  rm -f "$installed_plist"
  printf 'uninstalled %s\n' "$label"
  exit 0
fi

NODE_BIN=${NODE_BIN:-$(command -v node)} GOLEMS_ROOT=$golems_root HOME=$task_home \
  "$script_dir/render-plist.sh" "$source_plist" "$installed_plist"
plutil -lint "$installed_plist" >/dev/null

if [[ $skip_launchctl == 0 ]]; then
  launchctl bootout "$domain/$label" 2>/dev/null || true
  launchctl bootstrap "$domain" "$installed_plist"
fi

printf 'installed %s\n' "$installed_plist"
printf 'schedule: login and daily at 07:30 local time\n'
