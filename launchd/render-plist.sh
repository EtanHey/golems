#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'usage: %s SOURCE.plist DESTINATION.plist\n' "$0" >&2
  exit 2
fi

source_plist=$1
destination_plist=$2
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
golems_root=${GOLEMS_ROOT:-$(cd "$script_dir/.." && pwd -P)}
task_home=${HOME:?HOME must be set}
node_bin=${NODE_BIN:-$(command -v node)}

[[ -f $source_plist ]] || { printf 'missing plist template: %s\n' "$source_plist" >&2; exit 2; }
mkdir -p "$(dirname "$destination_plist")"

TASK_HOME=$task_home GOLEMS_PATH=$golems_root TASK_NODE=$node_bin perl -pe '
  BEGIN {
    for my $name (qw(TASK_HOME GOLEMS_PATH TASK_NODE)) {
      $ENV{$name} =~ s/&/&amp;/g;
      $ENV{$name} =~ s/</&lt;/g;
      $ENV{$name} =~ s/>/&gt;/g;
    }
  }
  s/\@HOME\@/$ENV{TASK_HOME}/g;
  s/\@GOLEMS_ROOT\@/$ENV{GOLEMS_PATH}/g;
  s/\@NODE_BIN\@/$ENV{TASK_NODE}/g;
' "$source_plist" > "$destination_plist"

if grep -E -q '@[A-Z][A-Z0-9_]*@' "$destination_plist"; then
  printf 'unresolved plist token in %s\n' "$destination_plist" >&2
  exit 2
fi
