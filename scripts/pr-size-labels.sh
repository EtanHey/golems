#!/usr/bin/env bash
# One PR size-label scheme for the whole fleet: size:XS / size:S / size:M / size:L.
#
# Why this exists (2026-09-05):
#   Fleet canon rule 9 requires a size label at open. On 2026-09-05 the fleet
#   merged 56 PRs and 39 of them carried no size label at all, while the 17 that
#   did were split across TWO incompatible schemes -- `size/XS` (slash) in
#   golems, coach and homebrew-layers, `size:XS` (colon) in orchestrator,
#   cmuxlayer and golems-history -- with different colors and contradictory
#   descriptions (cmuxlayer's `size:XS` claimed "50 changed lines or fewer",
#   orchestrator's claimed "tight-loop size"). A rule nobody can mechanically
#   apply is not a rule. This script is the mechanical part.
#
#   COLON is the surviving scheme: `size:XS`. Slash labels are RENAMED, never
#   deleted and recreated -- `gh label edit --name` keeps the label attached to
#   every PR that already had it; delete+create silently strips history.
#
# Subcommands
#   ensure <repo>          Create/normalize the four labels in <repo>, renaming
#                          any legacy `size/*` to `size:*` first. Idempotent.
#   compute <pr>           Size a PR from its hand-written diff and apply exactly
#                          one `size:*` label, removing every other `size:*` or
#                          `size/*` it carries.
#   check <pr>             Exit 0 always; emit a GitHub `::warning::` when the PR
#                          has no `size:*` label. Used by CI (warn, never fail).
#   classify <lines>       Print the label for a hand-written line count.
#
# Sizing rule
#   count = additions + deletions across files that are NOT generated
#           (see GENERATED_GLOBS below)
#     count <=  20  -> size:XS
#     count <= 100  -> size:S
#     count <= 400  -> size:M
#     count >  400  -> size:L   (canon 9: needs a one-line why)
#   400 is canon 9's split point, so `size:L` and "you owe a split rationale"
#   are the same signal.
#
# Exit codes: 0 ok, 1 runtime failure, 2 usage error.

set -euo pipefail

DEFAULT_OWNER="${PR_SIZE_LABELS_OWNER:-EtanHey}"

# Test seam: bats points this at a stub so the suite never touches the network.
GH_BIN="${PR_SIZE_LABELS_GH:-gh}"

XS_MAX=20
S_MAX=100
M_MAX=400

# name|color|description -- the single source of truth for the scheme.
LABEL_SPEC=(
  "size:XS|0E8A16|Tight-loop PR size: 20 or fewer hand-written lines changed"
  "size:S|FBCA04|Tight-loop PR size: 21-100 hand-written lines changed"
  "size:M|D93F0B|Tight-loop PR size: 101-400 hand-written lines changed"
  "size:L|B60205|Tight-loop PR size: over 400 hand-written lines changed; canon 9 needs a one-line why"
)

# Files whose lines are NOT hand-written and are excluded from the count.
# Matched against the path with a leading slash prepended, so a bare `*/dist/*`
# entry catches both `dist/app.js` and `packages/x/dist/app.js`.
GENERATED_GLOBS=(
  '*.lock'
  '*.lockb'
  '*/package-lock.json'
  '*/yarn.lock'
  '*/pnpm-lock.yaml'
  '*/go.sum'
  '*.min.js'
  '*.min.css'
  '*.map'
  '*.snap'
  '*.pb.go'
  '*_pb2.py'
  '*.generated.*'
  '*/node_modules/*'
  '*/dist/*'
  '*/build/*'
  '*/.next/*'
  '*/vendor/*'
  '*/generated/*'
  '*/__generated__/*'
  '*/__snapshots__/*'
  '*/fixtures/*'
  '*/__fixtures__/*'
  '*/testdata/*'
)

die() { printf '%s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: pr-size-labels.sh <subcommand>

  ensure <repo>                       create/normalize size:XS|S|M|L in <repo>,
                                      renaming legacy size/* first (idempotent)
  compute <pr> --repo <owner/name>    size the PR from its hand-written diff and
                                      apply exactly one size:* label
                                      [--dry-run] [--files-tsv <path>]
  check <pr> --repo <owner/name>      warn (never fail) when the PR has no size:*
  classify <lines>                    print the label for a line count

  <repo> may be bare (`golems`); it is qualified with $PR_SIZE_LABELS_OWNER
  (default EtanHey).

  Sizing: additions + deletions over non-generated files.
          <=20 XS, <=100 S, <=400 M, >400 L (canon 9's 400 split point).
USAGE
  exit 2
}

# EtanHey/golems -> EtanHey/golems; golems -> $DEFAULT_OWNER/golems
qualify_repo() {
  local repo="$1"
  case "$repo" in
    */*) printf '%s\n' "$repo" ;;
    *)   printf '%s/%s\n' "$DEFAULT_OWNER" "$repo" ;;
  esac
}

is_generated() {
  local path="/$1" glob
  for glob in "${GENERATED_GLOBS[@]}"; do
    # shellcheck disable=SC2053  # intentional glob match, not a literal compare
    [[ "$path" == $glob ]] && return 0
  done
  return 1
}

classify() {
  local n="$1"
  [[ "$n" =~ ^[0-9]+$ ]] || die "classify: not a non-negative integer: $n"
  if   (( n <= XS_MAX )); then printf 'size:XS\n'
  elif (( n <= S_MAX  )); then printf 'size:S\n'
  elif (( n <= M_MAX  )); then printf 'size:M\n'
  else                         printf 'size:L\n'
  fi
}

# Reads `path<TAB>additions<TAB>deletions` on stdin, prints the hand-written total.
sum_handwritten() {
  local path add del total=0
  while IFS=$'\t' read -r path add del; do
    [[ -n "$path" ]] || continue
    is_generated "$path" && continue
    total=$(( total + ${add:-0} + ${del:-0} ))
  done
  printf '%s\n' "$total"
}

cmd_ensure() {
  [[ $# -eq 1 ]] || usage
  local repo; repo="$(qualify_repo "$1")"

  local existing
  existing="$("$GH_BIN" label list --repo "$repo" --limit 300 --json name --jq '.[].name')"

  local spec name color desc size legacy
  for spec in "${LABEL_SPEC[@]}"; do
    IFS='|' read -r name color desc <<<"$spec"
    size="${name#size:}"
    legacy="size/${size}"

    if grep -qxF "$legacy" <<<"$existing"; then
      if grep -qxF "$name" <<<"$existing"; then
        printf 'WARN %s: both %s and %s exist; leaving %s in place (renaming would collide, deleting would strip it from old PRs)\n' \
          "$repo" "$legacy" "$name" "$legacy" >&2
      else
        "$GH_BIN" label edit "$legacy" --repo "$repo" --name "$name" >/dev/null
        printf 'RENAMED %s: %s -> %s\n' "$repo" "$legacy" "$name"
      fi
    fi

    "$GH_BIN" label create "$name" --repo "$repo" --color "$color" --description "$desc" --force >/dev/null
    printf 'ENSURED %s: %s\n' "$repo" "$name"
  done
}

cmd_compute() {
  local repo="" pr="" dry=0 files_tsv=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo)       repo="${2:-}"; shift 2 ;;
      --dry-run)    dry=1; shift ;;
      --files-tsv)  files_tsv="${2:-}"; shift 2 ;;  # test seam: skip the API
      -*)           usage ;;
      *)            pr="$1"; shift ;;
    esac
  done
  [[ -n "$pr" ]] || usage
  [[ -n "$repo" ]] || die "compute: --repo <owner/name> is required"
  repo="$(qualify_repo "$repo")"

  local lines label
  if [[ -n "$files_tsv" ]]; then
    lines="$(sum_handwritten < "$files_tsv")"
  else
    lines="$("$GH_BIN" api "repos/${repo}/pulls/${pr}/files" --paginate \
      --jq '.[] | [.filename, .additions, .deletions] | @tsv' | sum_handwritten)"
  fi
  label="$(classify "$lines")"

  local current old_labels=() to_remove=() name
  current="$("$GH_BIN" pr view "$pr" --repo "$repo" --json labels --jq '.labels[].name')"
  while IFS= read -r name; do
    [[ "$name" =~ ^size[:/] ]] || continue
    old_labels+=("$name")
    [[ "$name" == "$label" ]] || to_remove+=("$name")
  done <<<"$current"

  local old="none"
  [[ ${#old_labels[@]} -gt 0 ]] && old="$(IFS=,; printf '%s' "${old_labels[*]}")"

  if (( dry == 0 )); then
    local args=(pr edit "$pr" --repo "$repo" --add-label "$label")
    for name in "${to_remove[@]:-}"; do
      [[ -n "$name" ]] && args+=(--remove-label "$name")
    done
    "$GH_BIN" "${args[@]}" >/dev/null
  fi

  # repo<TAB>pr<TAB>old<TAB>new<TAB>hand-written lines
  printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$pr" "$old" "$label" "$lines"
}

cmd_check() {
  local repo="" pr=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo) repo="${2:-}"; shift 2 ;;
      -*)     usage ;;
      *)      pr="$1"; shift ;;
    esac
  done
  [[ -n "$pr" ]] || usage
  [[ -n "$repo" ]] || die "check: --repo <owner/name> is required"
  repo="$(qualify_repo "$repo")"

  local current
  current="$("$GH_BIN" pr view "$pr" --repo "$repo" --json labels --jq '.labels[].name')"
  if grep -qE '^size:(XS|S|M|L)$' <<<"$current"; then
    printf 'OK %s#%s has a size label: %s\n' "$repo" "$pr" "$(grep -E '^size:' <<<"$current" | tr '\n' ' ')"
    return 0
  fi
  if grep -qE '^size/' <<<"$current"; then
    printf '::warning::%s#%s uses the retired size/* scheme. Run scripts/pr-size-labels.sh ensure %s, then compute %s --repo %s.\n' \
      "$repo" "$pr" "$repo" "$pr" "$repo"
    return 0
  fi
  printf '::warning::%s#%s has no size:* label (canon 9 wants one at open). Run: scripts/pr-size-labels.sh compute %s --repo %s\n' \
    "$repo" "$pr" "$pr" "$repo"
  return 0
}

main() {
  [[ $# -ge 1 ]] || usage
  local sub="$1"; shift
  case "$sub" in
    ensure)   cmd_ensure "$@" ;;
    compute)  cmd_compute "$@" ;;
    check)    cmd_check "$@" ;;
    classify) [[ $# -eq 1 ]] || usage; classify "$1" ;;
    -h|--help|help) usage ;;
    *)        usage ;;
  esac
}

main "$@"
