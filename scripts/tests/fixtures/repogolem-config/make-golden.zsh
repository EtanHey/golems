#!/usr/bin/env zsh
# Regenerate launchers.golden.zsh by running RALPH'S OWN launcher generator
# (_ralph_generate_launchers_from_registry, ralph/lib/ralph-registry.zsh) on
# registry.json in this directory. The golden pins repogolem-config.ts to
# Ralph's output format.
#
# Ralph's generator writes to $HOME/.config/ralphtools/launchers.zsh, so it
# runs with HOME pointed at a throwaway dir under the gitignored docs.local/.
# The one transformation: that dir's path is replaced with /home/fixture, the
# HOME the test passes to repogolem-config.ts (expands the fixture's ~/ path).
#
# Ralph's generator also runs _repogolem_generate_context_files, which copies
# CLAUDE.md/AGENTS.md/GEMINI.md into every project dir that exists. It is
# stubbed so a fixture path that happens to exist is never written to.
#
# Usage: zsh scripts/tests/fixtures/repogolem-config/make-golden.zsh
#        RALPH_LIB=<dir> overrides the lib (default ~/.config/ralphtools/lib).
set -euo pipefail

here=${0:A:h}
repo_root=${here:h:h:h:h}
ralph_lib=${RALPH_LIB:-$HOME/.config/ralphtools/lib}
[[ -f "$ralph_lib/ralph-registry.zsh" ]] || { print -u2 "no ralph-registry.zsh under $ralph_lib"; exit 1; }

mkdir -p "$repo_root/docs.local"
fake_home=$(mktemp -d "$repo_root/docs.local/repogolem-golden.XXXXXX")
trap 'rm -rf -- "$fake_home"' EXIT

HOME="$fake_home" RALPH_REGISTRY_FILE="$here/registry.json" zsh -f -c '
  source "$1/ralph-registry.zsh"
  _repogolem_generate_context_files() { :; }
  _ralph_generate_launchers_from_registry >/dev/null
' _ "$ralph_lib"

sed "s#${fake_home}#/home/fixture#g" "$fake_home/.config/ralphtools/launchers.zsh" > "$here/launchers.golden.zsh"
print "wrote $here/launchers.golden.zsh"
