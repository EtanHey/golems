#!/usr/bin/env zsh
set -euo pipefail

script_dir="${0:A:h}"
source_file="${script_dir}/golem-dispatch.zsh"
force=false

if [[ "${1:-}" == "--force" ]]; then
  force=true
  shift
fi

target_arg="${1:-$HOME/.config/ralphtools/golem-dispatch.zsh}"
target_file="${target_arg:A}"
home_dir="${HOME:A}"

if [[ ! -f "$source_file" ]]; then
  echo "Missing dispatcher source: $source_file" >&2
  exit 1
fi

if [[ "${EUID:-$(id -u)}" -eq 0 || -n "${SUDO_USER:-}" ]] && [[ "$force" != "true" ]]; then
  echo "Refusing privileged install without --force" >&2
  exit 1
fi

if [[ "$target_file" != "$home_dir" && "$target_file" != "$home_dir"/* ]]; then
  echo "Refusing to install outside HOME: $target_file" >&2
  exit 1
fi

if [[ -e "$target_file" && "$force" != "true" ]]; then
  if [[ -t 0 ]]; then
    printf 'Overwrite %s? [y/N] ' "$target_file" >&2
    read -r answer
    case "$answer" in
      y|Y|yes|YES) ;;
      *) echo "Install cancelled" >&2; exit 1 ;;
    esac
  else
    echo "Target exists; pass --force to overwrite non-interactively: $target_file" >&2
    exit 1
  fi
fi

mkdir -p "${target_file:h}"
cp "$source_file" "$target_file"
chmod +x "$target_file"
echo "Installed repoGolem dispatcher: $target_file"
