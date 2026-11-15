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
# The wrapper helper never replaces an existing executable, so rollback needs
# only the previous plist; its old executable remains byte-for-byte intact.
backup=""
if [[ -L "$installed" || ( -e "$installed" && ! -f "$installed" ) ]]; then
  echo "ERROR: refusing non-regular installed plist: $installed" >&2
  exit 1
fi
if [[ -f "$installed" ]]; then
  backup=$(mktemp "$installed.prev.XXXXXX")
  cp -p "$installed" "$backup"
fi
if [[ ${2:-} == --skip-launchctl ]]; then
  mv "$candidate" "$installed"
  [[ -z "$backup" ]] || echo "Activation skipped; previous plist retained: $backup"
  exit 0
fi

domain="gui/$(id -u)"
source "$script_dir/unload-label.sh"
unload_label "$label"
mv "$candidate" "$installed"
if ! launchctl bootstrap "$domain" "$installed"; then
  echo "ERROR: bootstrap failed for $label; restoring previous definition" >&2
  # A failed bootstrap may still have registered a job: remove it before restore.
  if ! unload_label "$label"; then
    echo "ERROR: could not unload failed job; previous plist retained: $backup" >&2
    exit 1
  fi
  if [[ -n "$backup" ]]; then
    cp -p "$backup" "$installed"
    if ! launchctl bootstrap "$domain" "$installed"; then
      echo "ERROR: rollback bootstrap failed; previous plist retained: $backup" >&2
    else
      echo "Restored previous job; backup retained: $backup" >&2
    fi
  else
    mv "$installed" "$candidate"
    echo "No previous plist; failed candidate retained: $candidate" >&2
  fi
  exit 1
fi
[[ -z "$backup" ]] || rm "$backup"
launchctl print "$domain/$label"
