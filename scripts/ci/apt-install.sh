#!/usr/bin/env bash
# Run as root (sudo bash scripts/ci/apt-install.sh <packages...>).
set -euo pipefail
[[ $# -gt 0 ]] || { echo 'usage: apt-install.sh <packages...>' >&2; exit 2; }
sources_dir=${APT_SOURCES_DIR:-/etc/apt}
command_timeout=${CI_APT_COMMAND_TIMEOUT:-150}
apt_options=(-o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20)
# CI caches only *.deb files here; apt's lock and partial files stay job-local.
if [[ -n ${CI_APT_ARCHIVES_DIR:-} ]]; then
  mkdir -p "$CI_APT_ARCHIVES_DIR/partial"
  apt_options+=(-o "Dir::Cache::Archives=$CI_APT_ARCHIVES_DIR" -o APT::Keep-Downloaded-Packages=true)
fi

switch_sources() {
  python3 - "$sources_dir" <<'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
archive = "http://archive.ubuntu.com/ubuntu"
security = "http://security.ubuntu.com/ubuntu"
deb822 = root / "sources.list.d/ubuntu.sources"
legacy = root / "sources.list"
found = False
if deb822.is_file():
    paragraphs = re.split(r"(\n\s*\n)", deb822.read_text())
    for i in range(0, len(paragraphs), 2):
        stanza = paragraphs[i]
        suites = re.search(r"^Suites:\s*(.*)$", stanza, re.M)
        if suites:
            uri = security if all(s.endswith("-security") for s in suites[1].split()) else archive
            paragraphs[i] = re.sub(r"^URIs:.*$", "URIs: " + uri, stanza, flags=re.M)
    deb822.write_text("".join(paragraphs))
    print(f"apt: direct-archive sources in {deb822}", flush=True)
    found = True
if legacy.is_file():
    def replace(match):
        prefix, uri, suite = match.groups()
        if uri.startswith("mirror+file:") or re.match(r"https?://(?:[\w.-]+\.)?ubuntu\.com/ubuntu/?$", uri):
            uri = security if suite.endswith("-security") else archive
        return prefix + uri + " " + suite
    legacy.write_text(re.sub(r"^(deb(?:-src)?\s+(?:\[[^\]]+\]\s+)?)(\S+)\s+(\S+)",
                             replace, legacy.read_text(), flags=re.M))
    print(f"apt: direct-archive sources in {legacy}", flush=True)
    found = True
if not found:
    sys.exit("apt: source switch failed: no sources file found")
PY
}

source_label=runner-configured
for attempt in 1 2 3; do
  if [[ $attempt -gt 1 ]]; then
    dpkg --configure -a || true
  fi
  if [[ $attempt == 2 ]]; then
    switch_sources
    source_label=direct-archive
  fi
  echo "apt: attempt=$attempt/3 source=$source_label"
  # Print the runner's actual URI(s), so a successful first attempt is traceable.
  for file in "$sources_dir/sources.list.d/ubuntu.sources" "$sources_dir/sources.list"; do
    if [[ -f $file ]]; then
      grep -E '^(URIs:|deb(-src)? )' "$file" || true
    fi
  done
  status=0
  timeout --kill-after=5 "$command_timeout" apt-get "${apt_options[@]}" update &&
    timeout --kill-after=5 "$command_timeout" apt-get "${apt_options[@]}" install -y --no-install-recommends "$@" && exit 0
  status=$?
  echo "apt: attempt $attempt failed ($status)" >&2
done
exit "$status"
