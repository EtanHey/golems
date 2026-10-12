#!/bin/sh
# Bootstrap needs only standard macOS/Linux utilities, curl, tar and shasum.
main() {
set -eu
umask 077
fail() { printf 'golems install: %s\n' "$*" >&2; exit 1; }
channel=nightly prefix=${HOME:?HOME is required}/.golems from='' sums='' replace=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --replace-checkout-links) replace=true; shift; continue ;;
    --channel|--prefix|--from-file|--sums)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail "missing value for $1"
      case "$1" in --channel) channel=$2 ;; --prefix) prefix=$2 ;; --from-file) from=$2 ;; --sums) sums=$2 ;; esac
      shift 2 ;;
    --help) printf '%s\n' 'install.sh [--channel nightly|<tag>] [--prefix PATH] [--from-file TARBALL --sums SHA256SUMS] [--replace-checkout-links]'; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done
case "$channel" in ''|*[!A-Za-z0-9._-]*) fail 'invalid channel/tag' ;; esac
[ -z "$from$sums" ] || { [ -n "$from" ] && [ -n "$sums" ]; } || fail '--from-file and --sums must be used together'
# shellcheck disable=SC2088 # Accept a literal tilde supplied as an argument.
case "$prefix" in '~') prefix=$HOME ;; '~/'*) prefix=$HOME/${prefix#\~/} ;; esac
case "$prefix" in -*) fail 'prefix must not start with a dash' ;; esac
for client in .claude .agents .codex; do
  [ ! -L "$HOME/$client" ] || fail "$HOME/$client must not be a symlink"
  [ "$client" = .codex ] || [ ! -L "$HOME/$client/skills" ] || fail "$HOME/$client/skills must not be a symlink"
done
mkdir -p "$prefix"
prefix=$(CDPATH='' cd -P "$prefix" && pwd)
for name in releases bin; do
  [ ! -L "$prefix/$name" ] || fail "$prefix/$name must not be a symlink"
  mkdir -p "$prefix/$name"
done
for name in current release.json release-history; do
  [ ! -e "$prefix/$name" ] || [ -L "$prefix/$name" ] || [ "$name" != current ] || fail 'current exists and is not a symlink'
  [ "$name" = current ] || [ ! -L "$prefix/$name" ] || fail "$name must not be a symlink"
  [ "$name" = current ] || [ ! -e "$prefix/$name" ] || [ -f "$prefix/$name" ] || fail "$name must be a regular file"
done
mkdir "$prefix/.install-lock" 2>/dev/null || fail "another install is active (or stale lock needs inspection): $prefix/.install-lock"
work='' hooks_pending=false previous_current=''
rollback_activation() {
  if [ -n "$previous_current" ]; then
    ln -s "$previous_current" "$work/restore-current"
    atomic_move "$work/restore-current" "$prefix/current"
  else rm -f "$prefix/current"; fi
  if [ -f "$work/previous-release.json" ]; then
    atomic_move "$work/previous-release.json" "$prefix/release.json"
  else rm -f "$prefix/release.json"; fi
}
cleanup() {
  if [ "$hooks_pending" = true ]; then rollback_activation; fi
  [ -z "$work" ] || rm -rf "$work"; rmdir "$prefix/.install-lock"
}
trap cleanup 0
trap 'exit 1' 1 2 3 15
work=$(mktemp -d "$prefix/.install-XXXXXXXX")

# Parse JSON without a runtime dependency. Only selected scalar fields are
# emitted; scan a character array so macOS awk does not repeatedly copy the
# full document. Unselected strings are validated without building their value.
json_fields() {
  awk -v catalog="${3-false}" '
  function bad() { exit 1 }
  function ws() { while (pos <= size && ch[pos] ~ /[ \t\r\n]/) pos++ }
  function selected(p) { return catalog=="true" || p ~ /^(version|commit|source|private_gate|files\.[0-9]+\.(path|sha256|mode)|([0-9]+\.)?(tag_name|draft|prerelease|created_at))$/ }
  function str(capture, out,c,e,h,i) {
    if (ch[pos++] != "\"") bad()
    while (pos <= size) {
      c=ch[pos++]; if (c=="\"") return out
      if (c ~ /[[:cntrl:]]/) bad()
      if (c=="\\") {
        e=ch[pos++]
        if (e=="u") { h=""; for(i=0;i<4;i++) h=h ch[pos+i]; if (length(h)!=4 || h ~ /[^0-9a-fA-F]/) bad(); pos+=4; c="\\u" h }
        else if (e ~ /^["\\\/]$/) c=e
        else if (e ~ /^[bfnrt]$/) c="\\" e
        else bad()
      }
      if (capture) out=out c
    }
    bad()
  }
  function value(p, c,k,n,v,q) {
    ws(); c=ch[pos]
    if (c=="{" || c=="[") {
      if(catalog=="true") print p "\t" (c=="{" ? "object" : "array")
      pos++; ws(); q=(c=="{" ? "}" : "]")
      if (ch[pos]==q) {pos++; return}
      n=0
      while (1) {
        ws(); if (c=="{") {k=str(1); ws(); if(ch[pos++]!=":") bad()} else k=n++
        v=(p=="" ? k : p "." k); if (seen[v]++) bad(); value(v); ws()
        k=ch[pos++]; if(k==q) return; if(k!=",") bad()
      }
    }
    if (c=="\"") v=str(selected(p))
    else { v=""; while (pos<=size && ch[pos] !~ /[ \t\r\n,}\]]/) v=v ch[pos++]
      if(v !~ /^(true|false|null|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?)$/) bad()
    }
    if (selected(p)) print p "\t" v (catalog=="true" ? "\t" (c=="\"" ? "string" : "scalar") : "")
  }
  {nchars=split($0,line,""); for(j=1;j<=nchars;j++) ch[++size]=line[j]; ch[++size]="\n"} END {pos=1; value(""); ws(); if(pos<=size) bad()}
  ' "$1" > "$2" || fail "invalid JSON: $1"
}
hash() { shasum -a 256 "$1" | awk '{print $1}'; }
check_sum() {
  expected=$(awk -v name="$2" '$2==name {h=$1; n++} END {if(n!=1 || length(h)!=64 || h ~ /[^0-9a-f]/) exit 1; print h}' "$work/SHA256SUMS") || fail "missing/ambiguous checksum: $2"
  [ "$(hash "$1")" = "$expected" ] || fail "checksum mismatch: $2"
}
# Follow redirects ourselves: curl can restrict protocols but not redirect hosts.
download() {
  download_url=$1 download_path=$2 redirects=0
  while :; do
    case "$download_url" in
      https://api.github.com/*|https://github.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) ;;
      *) fail "refusing download host: $download_url" ;;
    esac
    set -- -sS --retry 2 --connect-timeout 20 --max-time 120 --proto '=https' --proto-redir '=https'
    case "$download_url" in https://api.github.com/*)
      [ -z "${GITHUB_TOKEN-}" ] || set -- "$@" -H "Authorization: Bearer $GITHUB_TOKEN" ;;
    esac
    response=$(curl "$@" "$download_url" -o "$download_path" -w '%{http_code}\n%{redirect_url}') || fail 'download transport failed'
    status=$(printf '%s\n' "$response" | sed -n '1p')
    case "$status" in
      200) return ;;
      301|302|303|307|308)
        [ "$redirects" -lt 5 ] || fail 'too many download redirects'
        download_url=$(printf '%s\n' "$response" | sed -n '2p'); redirects=$((redirects + 1)) ;;
      403|429)
        download_host=${download_url#https://}; download_host=${download_host%%/*}
        case "$download_host" in api.github.com) download_source='GitHub API' ;; *) download_source='GitHub asset download' ;; esac
        fail "$download_source access denied by $download_host (HTTP $status; possible rate limit). Wait before retrying or set GITHUB_TOKEN for authenticated API requests." ;;
      *) fail "download failed (HTTP $status)" ;;
    esac
  done
}
if [ -n "$from" ]; then
  filename=$(basename "$from"); cp "$from" "$work/$filename"; cp "$sums" "$work/SHA256SUMS"
else
  api=https://api.github.com/repos/EtanHey/golems/releases
  tag=$channel
  if [ "$channel" = nightly ]; then
    download "$api?per_page=30&page=1" "$work/api.json"
    json_fields "$work/api.json" "$work/api.tsv"
    awk -F '\t' '{split($1,k,"."); a[k[1],k[2]]=$2; ids[k[1]]=1} END {for(i in ids) if(a[i,"draft"]=="false") print a[i,"created_at"] "\t" a[i,"tag_name"]}' "$work/api.tsv" > "$work/candidates"
    tag=$(sort -r "$work/candidates" | awk -F '\t' 'NR==1 {print $2}')
    [ -n "$tag" ] || fail 'no published nightly release found'
  fi
  printf '%s\n' "$tag" | awk '!/^v[0-9][0-9][0-9][0-9]\.[0-9][0-9]\.[0-9][0-9]-[0-9a-f]+$/ {exit 1}' || fail 'unsupported release tag'
  download "$api/tags/$tag" "$work/release.json"
  json_fields "$work/release.json" "$work/api.tsv"
  [ "$(awk -F '\t' '$1=="draft" {print $2}' "$work/api.tsv")" = false ] || fail 'release is a draft'
  [ "$(awk -F '\t' '$1=="tag_name" {print $2}' "$work/api.tsv")" = "$tag" ] || fail 'release tag mismatch'
  filename=golems-${tag#v}.tar.gz
  url=https://github.com/EtanHey/golems/releases/download/$tag
  download "$url/$filename" "$work/$filename"
  download "$url/SHA256SUMS" "$work/SHA256SUMS"
  download "$url/MANIFEST.json" "$work/MANIFEST.json"
fi
printf '%s\n' "$filename" | awk '!/^golems-[0-9][0-9][0-9][0-9]\.[0-9][0-9]\.[0-9][0-9]-[0-9a-f]+\.tar\.gz$/ {exit 1}' || fail 'unsupported tarball filename'
check_sum "$work/$filename" "$filename"
tarball_sha256=$(hash "$work/$filename")
# Reject traversal, duplicate files, links and special entries before extraction.
tar -tzf "$work/$filename" > "$work/members"
awk '{sub(/^\.\//,""); if($0=="" || $0 ~ /[^A-Za-z0-9_.\/+@-]/ || $0 ~ /^\// || $0 ~ /(^|\/)\.\.?($|\/)/ || ($0 !~ /\/$/ && seen[$0]++)) exit 1}' "$work/members" || fail 'unsafe archive path'
awk '{sub(/^\.\//,""); if($0 !~ /\/$/) print}' "$work/members" | sort > "$work/archive-files"
tar -tvzf "$work/$filename" > "$work/types"
awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {exit 1}' "$work/types" || fail 'unsafe archive entry type'
if [ -n "$from" ]; then tar -xOzf "$work/$filename" MANIFEST.json > "$work/MANIFEST.json"; fi
check_sum "$work/MANIFEST.json" MANIFEST.json
manifest_sha256=$(hash "$work/MANIFEST.json")
json_fields "$work/MANIFEST.json" "$work/manifest.tsv"
version=$(awk -F '\t' '$1=="version" {print $2}' "$work/manifest.tsv")
commit=$(awk -F '\t' '$1=="commit" {print $2}' "$work/manifest.tsv")
[ "$filename" = "golems-$version.tar.gz" ] && [ "${#version}" -eq 18 ] || fail 'manifest version mismatch'
[ "${#commit}" -eq 40 ] && [ "$version" = "${version%-*}-$(printf '%.7s' "$commit")" ] || fail 'manifest commit mismatch'
case "$commit" in *[!0-9a-f]*) fail 'invalid commit' ;; esac
awk -F '\t' '$1 ~ /^files\./ {split($1,k,"."); a[k[2],k[3]]=$2; ids[k[2]]=1} END {for(i in ids) {p=a[i,"path"]; h=a[i,"sha256"]; m=a[i,"mode"]; if(p=="" || p ~ /[^A-Za-z0-9_.\/+@-]/ || p ~ /^\// || p ~ /(^|\/)\.\.?($|\/)/ || p=="MANIFEST.json" || seen[p]++ || length(h)!=64 || h ~ /[^0-9a-f]/ || (m!="0644" && m!="0755")) exit 1; print p "\t" h "\t" m; n++} if(!n) exit 1}' "$work/manifest.tsv" > "$work/files" || fail 'invalid manifest file entries'
{ printf 'MANIFEST.json\n'; cut -f1 "$work/files"; } | sort > "$work/manifest-files"
cmp -s "$work/archive-files" "$work/manifest-files" || fail 'archive files do not match manifest'
mkdir "$work/payload"
tar -xzf "$work/$filename" -C "$work/payload"
cmp -s "$work/MANIFEST.json" "$work/payload/MANIFEST.json" || fail 'archive manifest mismatch'
verify_files() {
  [ -z "$(find "$1" -type l -print)" ] || fail 'release contains a symlink'
  awk -F '\t' '{print $2 "  " $1}' "$work/files" > "$work/file-sums"
  (cd "$1" && shasum -a 256 -c "$work/file-sums" > "$work/verify.log" 2>&1) || fail 'file checksum mismatch (release payload)'
}
verify_files "$work/payload"
# Validate the entire catalog before activation, hooks or client writes.
json_fields "$work/payload/skills/catalog.json" "$work/catalog.tsv" true
awk -F '\t' '
  $1=="" {if($2!="object") exit 1; next}
  $1=="schema" {if($2!="1" || $3!="scalar") exit 1; schema++; next}
  $1=="roots" {if($2!="object") exit 1; next}
  $1=="roots.claude" || $1=="roots.agents" {if($2!="array") exit 1; next}
  $1 ~ /^roots\.(claude|agents)\.[0-9]+$/ {
    split($1,k,"."); if($3!="string" || $2 !~ /^[A-Za-z0-9][A-Za-z0-9_-]*$/ || seen[k[2],$2]++) exit 1
    counts[k[2]]++; print k[2] "\t" $2; next
  }
  {exit 1}
  END {if(schema!=1 || !counts["claude"] || !counts["agents"]) exit 1}
' "$work/catalog.tsv" > "$work/catalog" || fail 'invalid skill catalog'
while IFS="$(printf '\t')" read -r client name; do
  [ -f "$work/payload/skills/golem-powers/$name/SKILL.md" ] || fail "skill catalog entry has no SKILL.md: $name"
done < "$work/catalog"
destination=$prefix/releases/$version
if [ -e "$destination" ] || [ -L "$destination" ]; then
  [ -d "$destination" ] && [ ! -L "$destination" ] || fail 'existing release is not a directory'
  cmp -s "$work/MANIFEST.json" "$destination/MANIFEST.json" || fail 'existing release manifest mismatch'
  verify_files "$destination"
else
  for mode in 0644 0755; do
    awk -F '\t' -v mode="$mode" '$3==mode {print $1}' "$work/files" > "$work/modes"
    [ ! -s "$work/modes" ] || (cd "$work/payload" && xargs -n 100 chmod "$mode" < "$work/modes")
  done
  mv "$work/payload" "$destination"
fi
already=false
[ "$(readlink "$prefix/current" 2>/dev/null || :)" != "releases/$version" ] || already=true
if [ "$already" = true ] && [ "$replace" = false ]; then printf 'golems %s already current\ncommit: %s\ntarball sha256: %s\n' "$version" "$commit" "$tarball_sha256"; exit 0; fi
# GNU -T and BSD -h both replace the symlink itself, including directory targets.
atomic_move() { mv -fT "$1" "$2" 2> "$work/mv-error" || mv -fh "$1" "$2"; }
# Client hooks stay pinned to verified releases. Fail before other host writes
# if a client receipt cannot be interpreted or its runtime is unavailable.
hook_source='' hook_receipt=$HOME/.claude/hooks/golems-hooks-release.json
if [ -e "$hook_receipt" ] || [ -L "$hook_receipt" ]; then
  [ ! -L "$HOME/.claude/hooks" ] && [ ! -L "$hook_receipt" ] && [ -f "$hook_receipt" ] || fail 'client hook receipt must be a regular file in a regular hooks directory'
  json_fields "$hook_receipt" "$work/hooks.tsv"
  [ "$(awk -F '\t' '$1=="private_gate" {print $2}' "$work/hooks.tsv")" = 'skipped (client host)' ] || fail 'invalid client hook receipt'
  hook_source=$(awk -F '\t' '$1=="source" {print $2}' "$work/hooks.tsv")
  case "$hook_source" in /*) ;; *) fail 'invalid client hook source' ;; esac
  command -v node >/dev/null 2>&1 || fail 'client hook update requires node; previous release and hooks retained'
  awk '/^export const CLIENT_INSTALL_PROTOCOL = 1;/ {ok=1} END {exit !ok}' "$destination/scripts/hooks/release-hooks.mjs" || fail 'client hook update requires rollback protocol 1; previous release and hooks retained'
  previous_current=$(readlink "$prefix/current" 2>/dev/null || :)
  [ ! -f "$prefix/release.json" ] || cp -p "$prefix/release.json" "$work/previous-release.json"
  if [ "$already" = false ]; then
    printf '{"version":"%s","commit":"%s","channel":"%s","installed_at":"%s","tarball_sha256":"%s","manifest_sha256":"%s"}\n' "$version" "$commit" "$channel" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tarball_sha256" "$manifest_sha256" > "$work/release.json"
    ln -s "releases/$version" "$work/current"
    hooks_pending=true
    atomic_move "$work/current" "$prefix/current"
    atomic_move "$work/release.json" "$prefix/release.json"
  fi
  if ! node "$prefix/current/scripts/hooks/install-hooks.mjs" --host client --source "$prefix/current" --apply; then
    fail 'client hook reinstallation failed; restoring previous release and hooks'
  fi
  hooks_pending=false
fi
link_skill() {
  link=$1 target=$2
  if [ -L "$link" ]; then
    old=$(readlink "$link"); [ "$old" != "$target" ] || return 0
    resolved=$(resolve_skill_link "$link") || { printf 'Keeping unresolved link %s -> %s\n' "$link" "$old"; return 0; }
    case "$resolved" in "$prefix/releases/"*) ;;
      *) if is_golems_checkout_skill "$resolved"; then
        if [ "$replace" = false ]; then printf 'Keeping checkout link %s; use --replace-checkout-links\n' "$link"; return 0; fi
      else printf 'Keeping existing link %s -> %s\n' "$link" "$old"; return 0; fi ;;
    esac
  elif [ -e "$link" ]; then printf 'Keeping existing path %s\n' "$link"; return 0; fi
  ln -s "$target" "$work/skill-link"
  atomic_move "$work/skill-link" "$link"
  if [ "${3-false}" = true ]; then printf 'Linked %s -> %s\n' "$link" "$target"; fi
}
is_golems_checkout_skill() (
  checkout=${1%/skills/*}
  case "$checkout" in
    */golems) exit 0 ;;
    */golems/.worktrees/*)
      worktree=${checkout##*/golems/.worktrees/}
      case "$worktree" in ''|*/*) exit 1 ;; *) exit 0 ;; esac ;;
    *) exit 1 ;;
  esac
)
# Resolve relative links and checkout aliases before deciding who owns them.
# Dangling paths are normalized too, so stale links can be migrated safely.
resolve_skill_link() (
  path=$1 hops=0
  while :; do
    parent=$(dirname "$path") base=$(basename "$path")
    while [ ! -d "$parent" ]; do
      [ ! -L "$parent" ] && [ "$parent" != / ] || exit 1
      base=$(basename "$parent")/$base; parent=$(dirname "$parent")
    done
    parent=$(CDPATH='' cd -P "$parent" && pwd) || exit 1
    path=$(printf '%s/%s\n' "$parent" "$base" | awk -F / '{n=0; for(i=1;i<=NF;i++) if($i=="..") {if(n) n--} else if($i!="" && $i!=".") parts[++n]=$i; for(i=1;i<=n;i++) printf "/%s",parts[i]; print ""}')
    if [ ! -L "$path" ]; then
      if [ -d "$path" ]; then CDPATH='' cd -P "$path" && pwd; else printf '%s\n' "$path"; fi
      exit
    fi
    hops=$((hops + 1)); [ "$hops" -le 40 ] || exit 1
    target=$(readlink "$path") || exit 1
    case "$target" in /*) path=$target ;; *) path=$(dirname "$path")/$target ;; esac
  done
)
for client in .claude .agents; do
  mkdir -p "$HOME/$client/skills"
  awk -F '\t' -v client="${client#.}" '$1==client {print $2}' "$work/catalog" > "$work/client-catalog"
  for link in "$HOME/$client/skills/"*; do
    [ -L "$link" ] || continue
    name=$(basename "$link")
    awk -v name="$name" '$0==name {found=1} END {exit !found}' "$work/client-catalog" && continue
    resolved=$(resolve_skill_link "$link") || continue
    case "$resolved" in "$prefix/releases/"*) rm "$link"; printf 'Removed retired release link %s\n' "$link" ;; esac
  done
  while IFS= read -r name; do
    link_skill "$HOME/$client/skills/$name" "$prefix/current/skills/golem-powers/$name"
  done < "$work/client-catalog"
done
mkdir -p "$HOME/.codex"
if [ ! -e "$HOME/.codex/skills" ] && [ ! -L "$HOME/.codex/skills" ]; then ln -s "$HOME/.agents/skills" "$HOME/.codex/skills"
elif [ -d "$HOME/.codex/skills" ] && [ ! -L "$HOME/.codex/skills" ]; then
  awk -F '\t' '$1=="agents" {print $2}' "$work/catalog" > "$work/client-catalog"
  for link in "$HOME/.codex/skills/"* "$HOME/.codex/skills/".[!.]* "$HOME/.codex/skills/"..?*; do
    [ -e "$link" ] || [ -L "$link" ] || continue
    name=$(basename "$link")
    awk -v name="$name" '$0==name {found=1} END {exit !found}' "$work/client-catalog" && continue
    case "$name" in .*) ;; *)
      if [ -L "$link" ] && [ "$(readlink "$link")" = "$HOME/.agents/skills/$name" ]; then
        remove_retired=false
        if [ ! -e "$link" ]; then remove_retired=true
        else
          resolved=$(resolve_skill_link "$link") || resolved=''
          case "$resolved" in "$prefix/releases/"*) remove_retired=true ;; esac
        fi
        if [ "$remove_retired" = true ]; then
          rm "$link"; printf 'Removed retired release link %s\n' "$link"; continue
        fi
      fi ;;
    esac
    printf 'Keeping existing path %s\n' "$link"
  done
  while IFS= read -r name; do
    link_skill "$HOME/.codex/skills/$name" "$HOME/.agents/skills/$name" true
  done < "$work/client-catalog"
elif [ "$(readlink "$HOME/.codex/skills" 2>/dev/null || :)" != "$HOME/.agents/skills" ]; then printf 'Keeping existing Codex skills path %s\n' "$HOME/.codex/skills"; fi
for cli in pr-watch golems-cli; do
  [ ! -e "$prefix/bin/$cli" ] || [ -f "$prefix/bin/$cli" ] || fail "invalid CLI path: $cli"
  cat > "$work/$cli" <<'WRAPPER'
#!/bin/sh
set -eu
prefix=$(CDPATH='' cd -P "$(dirname "$0")/.." && pwd)
case "$(basename "$0")" in
  pr-watch) exec "$prefix/current/scripts/pr-watch" "$@" ;;
  golems-cli)
    if [ "${1-}" = update ]; then shift; exec sh "$prefix/current/scripts/release/install.sh" --prefix "$prefix" "$@"; fi
    exec bun "$prefix/current/packages/golem-skills/src/index.ts" "$@" ;;
esac
WRAPPER
  chmod 755 "$work/$cli"; atomic_move "$work/$cli" "$prefix/bin/$cli"
done
if [ "$already" = false ]; then
  if [ -z "$hook_source" ]; then
    printf '{"version":"%s","commit":"%s","channel":"%s","installed_at":"%s","tarball_sha256":"%s","manifest_sha256":"%s"}\n' "$version" "$commit" "$channel" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tarball_sha256" "$manifest_sha256" > "$work/release.json"
    ln -s "releases/$version" "$work/current"
    atomic_move "$work/current" "$prefix/current"
    atomic_move "$work/release.json" "$prefix/release.json"
  fi
  { printf '%s\n' "$version"; [ ! -f "$prefix/release-history" ] || cat "$prefix/release-history"; } | awk '!seen[$0]++' > "$work/history"
  : > "$work/release-history"
  retained=0
  while IFS= read -r old; do
    printf '%s\n' "$old" | awk 'length($0)!=18 || !/^[0-9][0-9][0-9][0-9]\.[0-9][0-9]\.[0-9][0-9]-[0-9a-f]+$/ {exit 1}' || fail 'invalid release history'
    retained=$((retained + 1))
    if [ "$retained" -le 3 ] || [ "$prefix/releases/$old" = "$hook_source" ]; then
      printf '%s\n' "$old" >> "$work/release-history"
    else
      [ ! -L "$prefix/releases/$old" ] || fail 'refusing to prune a release symlink'
      rm -rf "$prefix/releases/$old"
    fi
  done < "$work/history"
  atomic_move "$work/release-history" "$prefix/release-history"
fi
# shellcheck disable=SC2016 # The PATH hint intentionally prints a literal $PATH.
case :${PATH-}: in *:"$prefix/bin":*) ;; *) printf 'Add to PATH: export PATH="%s/bin:$PATH"\n' "$prefix" ;; esac
printf 'golems %s installed (%s)\ncommit: %s\ntarball sha256: %s\n' "$version" "$channel" "$commit" "$tarball_sha256"
}
main "$@"
