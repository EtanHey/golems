#!/usr/bin/env bash
# Enumerate disjoint ordinal shards of the original full commit range.
# Every selected commit still receives the complete current-policy tree scan.
set -euo pipefail
base=${1:?usage: boundary-history-shards.sh <base> [index] [count]}
index=${2:-0}
count=${3:-1}
[[ $index =~ ^(0|[1-9][0-9]?)$ && $count =~ ^([1-9]|1[0-6])$ ]] \
  && (( index < count )) || { echo 'invalid history shard (0 <= index < count <= 16)' >&2; exit 2; }
[[ $(git rev-parse --is-shallow-repository) == false ]] \
  || { echo 'shallow history cannot be sharded' >&2; exit 2; }
resolved=$(git rev-parse --verify "$base^{commit}")
git merge-base --is-ancestor "$resolved" HEAD
# pipefail propagates enumeration failures; callers materialize this output
# before scanning rather than hiding errors in a process substitution.
git rev-list --reverse "$resolved..HEAD" | awk -v shard="$index" -v count="$count" \
  '(NR - 1) % count == shard'
