#!/usr/bin/env bash
set -euo pipefail

repo_input="${1:-$PWD}"

if ! repo_root="$(git -C "$repo_input" rev-parse --show-toplevel 2>&1)"; then
  printf 'pr-queue: not a git repository: %s\n' "$repo_root" >&2
  exit 2
fi

if ! remote_url="$(git -C "$repo_root" remote get-url origin 2>&1)"; then
  printf 'pr-queue: origin remote unavailable: %s\n' "$remote_url" >&2
  exit 2
fi

case "$remote_url" in
  git@github.com:*) repo_slug="${remote_url#git@github.com:}" ;;
  ssh://git@github.com/*) repo_slug="${remote_url#ssh://git@github.com/}" ;;
  https://github.com/*) repo_slug="${remote_url#https://github.com/}" ;;
  http://github.com/*) repo_slug="${remote_url#http://github.com/}" ;;
  *)
    printf 'pr-queue: origin is not a github.com remote: %s\n' "$remote_url" >&2
    exit 2
    ;;
esac

repo_slug="${repo_slug%.git}"
if [[ "$repo_slug" != */* || "$repo_slug" == */*/* ]]; then
  printf 'pr-queue: cannot derive owner/repo from origin: %s\n' "$remote_url" >&2
  exit 2
fi

repo_owner="${repo_slug%%/*}"
repo_name="${repo_slug##*/}"
now_epoch="${PR_QUEUE_NOW_EPOCH:-$(date +%s)}"
if [[ ! "$now_epoch" =~ ^[0-9]+$ ]]; then
  printf 'pr-queue: PR_QUEUE_NOW_EPOCH must be an integer\n' >&2
  exit 2
fi

gh_args=(
  pr list
  --repo "$repo_owner/$repo_name"
  --state open
  --limit 1000
  --json "number,title,headRefName,headRepositoryOwner,isCrossRepository,author,createdAt,reviewDecision,statusCheckRollup"
)

if ! raw_prs="$(gh "${gh_args[@]}" 2>&1)"; then
  printf 'pr-queue: gh pr list failed: %s\n' "$raw_prs" >&2
  exit 2
fi

if ! result="$({
  printf '%s' "$raw_prs"
} | jq -c \
  --arg repo "$repo_name" \
  --arg owner "$repo_owner" \
  --argjson now "$now_epoch" '
    def check_failed:
      if .__typename == "StatusContext" then
        ((.state // "") == "FAILURE" or (.state // "") == "ERROR")
      else
        (.conclusion // "") as $conclusion
        | ($conclusion != "" and (["SUCCESS", "NEUTRAL", "SKIPPED"] | index($conclusion) | not))
      end;

    def check_pending:
      if .__typename == "StatusContext" then
        ((.state // "") == "PENDING" or (.state // "") == "EXPECTED")
      else
        ((.status // "") != "COMPLETED" or .conclusion == null)
      end;

    def ci_state:
      (.statusCheckRollup // []) as $checks
      | if ($checks | length) == 0 then "pending"
        elif any($checks[]; check_failed) then "failing"
        elif any($checks[]; check_pending) then "pending"
        else "passing"
        end;

    def age_days:
      ((($now - (.createdAt | fromdateiso8601)) / 86400) | floor)
      | if . < 0 then 0 else . end;

    map(select(
      ((.author.login // "") | ascii_downcase) == ($owner | ascii_downcase)
      or (
        ((.headRefName // "") | test("^(feat|fix|hygiene)/"; "i"))
        and (.isCrossRepository == false)
        and (((.headRepositoryOwner.login // "") | ascii_downcase) == ($owner | ascii_downcase))
      )
    ))
    | sort_by(.createdAt, .number)
    | map({
        n: .number,
        title,
        age_d: age_days,
        reviewDecision: (.reviewDecision // ""),
        ci: ci_state
      }) as $prs
    | {
        repo: $repo,
        open: ($prs | length),
        oldest_days: (if ($prs | length) == 0 then 0 else ($prs | map(.age_d) | max) end),
        prs: $prs
      }
  ' 2>&1)"; then
  printf 'pr-queue: jq transformation failed: %s\n' "$result" >&2
  exit 2
fi

printf '%s\n' "$result"
if ! open_count="$(printf '%s' "$result" | jq -er '
  .open
  | if type == "number" and . >= 0 and floor == . then .
    else error("invalid open count")
    end
' 2>/dev/null)"; then
  printf 'pr-queue: transformed queue has an invalid open count\n' >&2
  exit 2
fi
if [[ "$open_count" -gt 0 ]]; then
  exit 3
fi

exit 0
