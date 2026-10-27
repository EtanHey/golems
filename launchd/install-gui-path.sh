#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
label=com.golems.gui-path
installed_plist="${HOME:?HOME must be set}/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
dry_run=0
uninstall=0
for argument in "$@"; do
  case "$argument" in
    --dry-run) dry_run=1 ;;
    --uninstall) uninstall=1 ;;
    *) printf 'usage: %s [--dry-run] [--uninstall]\n' "$0" >&2; exit 2 ;;
  esac
done
if [[ $dry_run == 1 ]]; then
  if [[ $uninstall == 1 ]]; then
    printf 'Would bootout %s/%s if loaded and remove %s\n' "$domain" "$label" "$installed_plist"
  else
    printf 'Would render %s, bootout %s/%s if loaded, then bootstrap %s\n' "$installed_plist" "$domain" "$label" "$domain"
  fi
  exit 0
fi
if [[ $uninstall == 0 ]]; then
  "$script_dir/render-plist.sh" "$script_dir/$label.plist.in" "$installed_plist"
  plutil -lint "$installed_plist" >/dev/null
fi
if launchctl print "$domain/$label" >/dev/null 2>&1; then
  launchctl bootout "$domain/$label"
fi
if [[ $uninstall == 1 ]]; then
  rm -f "$installed_plist"
  printf 'uninstalled %s\n' "$label"
else
  launchctl bootstrap "$domain" "$installed_plist"
  printf 'installed %s\n' "$installed_plist"
fi
