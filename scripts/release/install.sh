#!/bin/sh
# Bootstrap needs only standard macOS/Linux utilities, curl, tar and shasum.
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
mkdir "$prefix/.install-lock" 2>/dev/null || fail 'another install is active (or a stale .install-lock needs inspection)'
work=''
cleanup() { [ -z "$work" ] || rm -rf "$work"; rmdir "$prefix/.install-lock"; }
trap cleanup 0
trap 'exit 1' 1 2 3 15
work=$(mktemp -d "$prefix/.install-XXXXXXXX")

# Parse JSON without a runtime dependency. Only selected scalar fields are
# emitted; descriptions/bodies can contain arbitrary escapes and nested JSON.
json_fields() {
  awk '
  function bad() { exit 1 }
  function ws() { while (substr(s,pos,1) ~ /[ \t\r\n]/ && pos <= length(s)) pos++ }
  function str( out,c,e,h) {
    if (substr(s,pos++,1) != "\"") bad()
    while (pos <= length(s)) {
      c=substr(s,pos++,1); if (c=="\"") return out
      if (c ~ /[[:cntrl:]]/) bad()
      if (c=="\\") {
        e=substr(s,pos++,1)
        if (e=="u") { h=substr(s,pos,4); if (length(h)!=4 || h ~ /[^0-9a-fA-F]/) bad(); pos+=4; c="\\u" h }
        else if (e ~ /^["\\\/]$/) c=e
        else if (e ~ /^[bfnrt]$/) c="\\" e
        else bad()
      }
      out=out c
    }
    bad()
  }
  function value(p, c,k,n,v,q) {
    ws(); c=substr(s,pos,1)
    if (c=="{" || c=="[") {
      pos++; ws(); q=(c=="{" ? "}" : "]")
      if (substr(s,pos,1)==q) {pos++; return}
      n=0
      while (1) {
        ws(); if (c=="{") {k=str(); ws(); if(substr(s,pos++,1)!=":") bad()} else k=n++
        v=(p=="" ? k : p "." k); if (seen[v]++) bad(); value(v); ws()
        k=substr(s,pos++,1); if(k==q) return; if(k!=",") bad()
      }
    }
    if (c=="\"") v=str()
    else { v=""; while (pos<=length(s) && substr(s,pos,1) !~ /[ \t\r\n,}\]]/) v=v substr(s,pos++,1)
      if(v !~ /^(true|false|null|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?)$/) bad()
    }
    if (p ~ /^(version|commit|files\.[0-9]+\.(path|sha256|mode)|([0-9]+\.)?(tag_name|draft|prerelease|published_at))$/) print p "\t" v
  }
  {s=s $0 "\n"} END {pos=1; value(""); ws(); if(pos<=length(s)) bad()}
  ' "$1" > "$2" || fail "invalid JSON: $1"
}
hash() { shasum -a 256 "$1" | awk '{print $1}'; }
check_sum() {
  expected=$(awk -v name="$2" '$2==name {h=$1; n++} END {if(n!=1 || length(h)!=64 || h ~ /[^0-9a-f]/) exit 1; print h}' "$work/SHA256SUMS") || fail "missing/ambiguous checksum: $2"
  [ "$(hash "$1")" = "$expected" ] || fail "checksum mismatch: $2"
}
download() { curl -fsSL --retry 2 --connect-timeout 20 --max-time 120 --proto '=https' --proto-redir '=https' "$1" -o "$2" || fail "download failed: $1"; }
if [ -n "$from" ]; then
  filename=$(basename "$from"); cp "$from" "$work/$filename"; cp "$sums" "$work/SHA256SUMS"
else
  api=https://api.github.com/repos/EtanHey/golems/releases
  tag=$channel
  if [ "$channel" = nightly ]; then
    page=1
    : > "$work/candidates"
    while :; do
      download "$api?per_page=100&page=$page" "$work/api.json"
      json_fields "$work/api.json" "$work/api.tsv"
      awk -F '\t' '{split($1,k,"."); a[k[1],k[2]]=$2; ids[k[1]]=1} END {for(i in ids) if(a[i,"draft"]=="false" && a[i,"prerelease"]=="true") print a[i,"published_at"] "\t" a[i,"tag_name"]}' "$work/api.tsv" >> "$work/candidates"
      count=$(awk -F '\t' '$1 ~ /^[0-9]+\.tag_name$/ {n++} END {print n+0}' "$work/api.tsv")
      [ "$count" -eq 100 ] || break
      page=$((page + 1))
    done
    tag=$(sort -r "$work/candidates" | awk -F '\t' 'NR==1 {print $2}')
    [ -n "$tag" ] || fail 'no published nightly prerelease found'
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
if [ "$already" = true ] && [ "$replace" = false ]; then printf 'golems %s already current\n' "$version"; exit 0; fi
# GNU -T and BSD -h both replace the symlink itself, including directory targets.
atomic_move() { mv -fT "$1" "$2" 2> "$work/mv-error" || mv -fh "$1" "$2"; }
link_skill() {
  link=$1 target=$2
  if [ -L "$link" ]; then
    old=$(readlink "$link"); [ "$old" != "$target" ] || return 0
    case "$old" in "$HOME/Gits/golems/"*)
      if [ "$replace" = false ]; then printf 'Keeping checkout link %s; use --replace-checkout-links\n' "$link"; return 0; fi ;;
      *) printf 'Keeping existing link %s -> %s\n' "$link" "$old"; return 0 ;;
    esac
  elif [ -e "$link" ]; then printf 'Keeping existing path %s\n' "$link"; return 0; fi
  ln -s "$target" "$work/skill-link"
  atomic_move "$work/skill-link" "$link"
}
for client in .claude .agents; do
  mkdir -p "$HOME/$client/skills"
  for skill in "$destination/skills/golem-powers/"*; do
    [ -d "$skill" ] || continue
    link_skill "$HOME/$client/skills/$(basename "$skill")" "$prefix/current/skills/golem-powers/$(basename "$skill")"
  done
done
mkdir -p "$HOME/.codex"
if [ ! -e "$HOME/.codex/skills" ] && [ ! -L "$HOME/.codex/skills" ]; then ln -s "$HOME/.agents/skills" "$HOME/.codex/skills"
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
  printf '{"version":"%s","commit":"%s","channel":"%s","installed_at":"%s","tarball_sha256":"%s"}\n' "$version" "$commit" "$channel" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tarball_sha256" > "$work/release.json"
  ln -s "releases/$version" "$work/current"
  atomic_move "$work/current" "$prefix/current"
  atomic_move "$work/release.json" "$prefix/release.json"
  { printf '%s\n' "$version"; [ ! -f "$prefix/release-history" ] || cat "$prefix/release-history"; } | awk '!seen[$0]++' > "$work/history"
  sed -n '4,$p' "$work/history" | while IFS= read -r old; do
    printf '%s\n' "$old" | awk 'length($0)!=18 || !/^[0-9][0-9][0-9][0-9]\.[0-9][0-9]\.[0-9][0-9]-[0-9a-f]+$/ {exit 1}' || fail 'invalid release history'
    [ ! -L "$prefix/releases/$old" ] || fail 'refusing to prune a release symlink'
    rm -rf "$prefix/releases/$old"
  done
  sed -n '1,3p' "$work/history" > "$work/release-history"
  atomic_move "$work/release-history" "$prefix/release-history"
fi
# shellcheck disable=SC2016 # The PATH hint intentionally prints a literal $PATH.
case :${PATH-}: in *:"$prefix/bin":*) ;; *) printf 'Add to PATH: export PATH="%s/bin:$PATH"\n' "$prefix" ;; esac
printf 'golems %s installed (%s)\n' "$version" "$channel"
