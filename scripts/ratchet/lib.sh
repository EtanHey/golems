# Shared by local-run.sh (and its tests). Source it; it defines functions only.

# ratchet_post_mode <install> <head> <with_count> <private_manifest> <private_files_count> <here_head> <here_dirty>
# Prints `post`, `replay: <why>` or `refuse: <why>`.
# - Anything that changes what is measured (another commit, a cherry-pick, a private-suite
#   override) is a replay: it never posts a PR-head verdict (#689 R1 B2).
# - A PR-head run must use the PR head's own row scripts: the invoking checkout must be AT the
#   head and clean, or the run is refused (#689 R1 M3).
ratchet_post_mode() {
  local install="$1" head="$2" with_count="$3" manifest="$4" files_count="$5" here_head="$6" here_dirty="$7"
  if [ "$install" != "$head" ]; then echo "replay: installs $install, not the PR head"; return; fi
  if [ "$with_count" != 0 ]; then echo "replay: --with cherry-picks change the tree"; return; fi
  if [ -n "$manifest" ] || [ "$files_count" != 0 ]; then echo "replay: private-suite override"; return; fi
  if [ "$here_head" != "$head" ]; then echo "refuse: row scripts are from $here_head, not the PR head $head (check out the head)"; return; fi
  if [ "$here_dirty" != 0 ]; then echo "refuse: the invoking checkout has uncommitted changes"; return; fi
  echo "post"
}
