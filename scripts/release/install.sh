#!/usr/bin/env bash
# On the new server:
#   sudo bash install.sh
# It finds routeflow-<version>-linux-<arch>.tar.gz (and its .sha256) next to itself. If they are not there it
# downloads the newest GitHub release for this machine (a private repo needs a read-only token, asked once and
# never saved). If the download fails it says how to upload the two files by hand and waits for them.
# It then checks the file against its checksum, unpacks it and starts the install questions.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
REPO=${ROUTEFLOW_REPO:-pouryare/routeflow}
API=${ROUTEFLOW_API:-https://api.github.com}
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64 | arm64) arch=arm64 ;; *) echo "unsupported machine: $(uname -m)" >&2; exit 1 ;; esac

newest() { ls -1 routeflow-*-linux-"$arch".tar.gz 2>/dev/null | sort -V | tail -1 || true; }

# Downloads the newest release's tarball and .sha256 for this machine. Returns 1 with the reason on stderr.
download() {
  local auth=() api=$API/repos/$REPO rel urls u name
  [ -z "${GITHUB_TOKEN:-}" ] || auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  rel=$(curl -fsSL --max-time 30 "${auth[@]}" -H "Accept: application/vnd.github+json" "$api/releases/latest") \
    || { echo "could not reach GitHub, or the repo is private and the token is missing or wrong" >&2; return 1; }
  # Asset api URLs (these work for private repos with a token) for this machine's tarball and its checksum.
  urls=$(printf '%s' "$rel" | python3 -c '
import json, sys
a = sys.argv[1]
for x in json.load(sys.stdin).get("assets", []):
    n = x["name"]
    if n.endswith("-linux-%s.tar.gz" % a) or n.endswith("-linux-%s.tar.gz.sha256" % a):
        print(x["url"], n)' "$arch") || return 1
  [ -n "$urls" ] || { echo "the newest release has no linux-$arch files" >&2; return 1; }
  while read -r u name; do
    echo "downloading $name"
    curl -fL --max-time 600 "${auth[@]}" -H "Accept: application/octet-stream" -o "$name.part" "$u" || { rm -f "$name.part"; return 1; }
    mv "$name.part" "$name"
  done <<<"$urls"
}

t=$(newest)
if [ -z "$t" ]; then
  echo "No routeflow-*-linux-$arch.tar.gz next to this script. Trying to download it from GitHub ($REPO)."
  if [ -z "${GITHUB_TOKEN:-}" ] && [ -r /dev/tty ]; then
    echo "If the repo is private, paste a read-only GitHub token (nothing shows as you type; it is not saved)."
    echo "Press Enter with nothing to try without one."
    read -rs -p "Token: " GITHUB_TOKEN </dev/tty || true; echo
    export GITHUB_TOKEN
  fi
  if ! download; then
    unset GITHUB_TOKEN
    echo
    echo "The download did not work. Upload the files by hand instead:"
    echo "  1. On your computer open https://github.com/$REPO/releases/latest and download the two files ending in"
    echo "     linux-$arch.tar.gz and linux-$arch.tar.gz.sha256"
    echo "  2. Upload them to this folder ($PWD) from your computer, for example:"
    echo "     scp routeflow-*-linux-$arch.tar.gz* root@THIS_SERVER_IP:$PWD/"
    echo "I will wait here and continue by myself when both files are in."
    while :; do
      t=$(newest)
      [ -n "$t" ] && [ -f "$t.sha256" ] && [ ! -e "$t.part" ] && break
      sleep 3
    done
    sleep 2 # let a copy in progress finish
  fi
  unset GITHUB_TOKEN
  t=$(newest)
fi
[ -n "$t" ] || { echo "no routeflow-*-linux-$arch.tar.gz found" >&2; exit 1; }
if [ -f "$t.sha256" ]; then sha256sum -c "$t.sha256"; else echo "no $t.sha256 next to it: the checksum was not checked" >&2; fi
[ "$(id -u)" = 0 ] || { echo "run it with sudo:  sudo bash install.sh" >&2; exit 1; }
tar -xzf "$t"
exec bash "${t%.tar.gz}/bin/routeflow" install "$t"
