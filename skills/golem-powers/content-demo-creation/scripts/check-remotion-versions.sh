#!/usr/bin/env bash
# check-remotion-versions.sh — fail if any installed @remotion/* + remotion package
# is on a different version (the mismatch that breaks React context/hooks/renders).
# Usage: check-remotion-versions.sh [project_dir]   (default: .)
set -uo pipefail
DIR="${1:-.}"
cd "$DIR" || { echo "cannot cd $DIR"; exit 2; }
[ -d node_modules ] || { echo "no node_modules in $DIR"; exit 2; }

declare -A seen
while IFS= read -r pkgjson; do
  name=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['name'])" "$pkgjson" 2>/dev/null) || continue
  ver=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$pkgjson" 2>/dev/null) || continue
  case "$name" in
    remotion|@remotion/*) seen["$name"]="$ver" ;;
  esac
done < <(find node_modules/remotion node_modules/@remotion -maxdepth 2 -name package.json 2>/dev/null)

versions=$(printf '%s\n' "${seen[@]}" | sort -u)
count=$(printf '%s\n' "$versions" | grep -c . || true)
echo "remotion packages found: ${#seen[@]} | distinct versions: $count"
for n in "${!seen[@]}"; do echo "  $n = ${seen[$n]}"; done | sort

if [ "${count:-0}" -gt 1 ]; then
  echo "VERSION MISMATCH — pin every @remotion/* + remotion to ONE exact version (drop the ^) before rendering."
  exit 1
fi
echo "OK — all remotion packages aligned."
exit 0
